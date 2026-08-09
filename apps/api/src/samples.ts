import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdirSync, promises as fsPromises } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Response } from 'express';
import type { AuthRequest, AuthUser } from './common';
import { RequirePermissions, text } from './common';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

const SAMPLE_TYPES = ['打样', '首单', '大货'] as const;
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// MIME -> 存储扩展名（白名单，杜绝任意扩展名）
const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

type UploadFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

// 样品类型：必填，且只能是「打样 / 首单 / 大货」之一
function sampleType(value: unknown): string {
  const v = text(value, 20);
  if (!v || !(SAMPLE_TYPES as readonly string[]).includes(v)) throw new BadRequestException('请选择有效的样品类型。');
  return v;
}

export type SampleInput = {
  customer?: unknown;
  storageLocation?: unknown;
  code?: unknown;
  productId?: unknown;
  productCode?: unknown;
  productName?: unknown;
  sampleType?: unknown;
  remark?: unknown;
};

@Injectable()
export class SampleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private id(value: string, label = '编号') {
    try {
      return BigInt(value);
    } catch {
      throw new BadRequestException(`${label}无效。`);
    }
  }

  private photoDirectory() {
    return resolve(
      process.env.RIM_SAMPLE_PHOTO_DIR ||
        join(process.env.LOCALAPPDATA || process.cwd(), 'ResidualInkManagementRuntime', 'data', 'photos'),
    );
  }

  private async mustSample(id: bigint) {
    const sample = await this.prisma.sampleArchive.findUnique({
      where: { id },
      include: {
        photos: { orderBy: { sortOrder: 'asc' } },
        product: { select: { id: true, code: true, name: true } },
      },
    });
    if (!sample) throw new NotFoundException('样品记录不存在。');
    return sample;
  }

  async list(query: { keyword?: string; customer?: string; storageLocation?: string; sampleType?: string }) {
    const keyword = text(query.keyword, 80);
    const customer = text(query.customer, 200);
    const storageLocation = text(query.storageLocation, 120);
    const sampleTypeValue = text(query.sampleType, 20);
    const conditions: Array<Record<string, unknown>> = [];
    if (keyword) {
      conditions.push({
        OR: [
          { customer: { contains: keyword } },
          { storageLocation: { contains: keyword } },
          { code: { contains: keyword } },
          { productCode: { contains: keyword } },
          { productName: { contains: keyword } },
        ],
      });
    }
    if (customer) conditions.push({ customer });
    if (storageLocation) conditions.push({ storageLocation });
    if (sampleTypeValue) conditions.push({ sampleType: sampleTypeValue });
    return this.prisma.sampleArchive.findMany({
      where: conditions.length ? { AND: conditions } : {},
      include: {
        photos: { orderBy: { sortOrder: 'asc' } },
        product: { select: { id: true, code: true, name: true } },
      },
      orderBy: { id: 'desc' },
      take: 500,
    });
  }

  async customerOptions() {
    const rows = await this.prisma.customer.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return { rows: rows.map((row) => ({ value: row.name, label: row.name, id: row.id.toString() })) };
  }

  async storageLocationOptions() {
    const rows = await this.prisma.sampleArchive.findMany({
      where: { storageLocation: { not: null } },
      orderBy: { storageLocation: 'asc' },
      distinct: ['storageLocation'],
      select: { storageLocation: true },
    });
    return {
      rows: rows
        .filter((row) => row.storageLocation)
        .map((row) => ({ value: row.storageLocation as string, label: row.storageLocation as string })),
    };
  }

  async productOptions(query: { keyword?: string; limit?: unknown }) {
    const keyword = text(query.keyword, 80);
    const limit = Math.min(Number(query.limit) || 50, 200);
    const rows = await this.prisma.product.findMany({
      where: keyword
        ? {
            OR: [
              { code: { contains: keyword } },
              { name: { contains: keyword } },
              { customerName: { contains: keyword } },
            ],
          }
        : {},
      orderBy: { id: 'desc' },
      take: limit,
    });
    return {
      rows: rows.map((row) => ({
        value: row.id.toString(),
        label: row.code,
        productCode: row.code,
        productName: row.name,
        customerName: row.customerName,
        sampleType: row.sampleType,
      })),
    };
  }

  /**
   * 解析产品关联：传入有效 productId 时校验产品并回填 code/name；
   * 未传入或为空时清空关联，改用自由输入的 code/name。
   */
  private async resolveProductLink(input: SampleInput): Promise<{
    productId: bigint | null;
    productCode: string | null;
    productName: string | null;
  }> {
    const rawId = input.productId;
    if (rawId === null || rawId === undefined || rawId === '') {
      return {
        productId: null,
        productCode: text(input.productCode, 80),
        productName: text(input.productName, 200),
      };
    }
    const id = this.id(String(rawId), '产品编号');
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new BadRequestException('关联的产品不存在。');
    return { productId: id, productCode: product.code, productName: product.name };
  }

  async create(input: SampleInput, user: AuthUser) {
    const code = text(input.code, 80);
    if (!code) throw new BadRequestException('编号不能为空。');
    if (await this.prisma.sampleArchive.findUnique({ where: { code } }))
      throw new BadRequestException('编号已存在。');
    const link = await this.resolveProductLink(input);
    const sample = await this.prisma.sampleArchive.create({
      data: {
        code,
        productId: link.productId,
        productCode: link.productCode,
        productName: link.productName,
        customer: text(input.customer, 200),
        storageLocation: text(input.storageLocation, 120),
        sampleType: sampleType(input.sampleType),
        remark: text(input.remark, 1000),
        createdBy: user.username,
        updatedBy: user.username,
      },
      include: {
        photos: { orderBy: { sortOrder: 'asc' } },
        product: { select: { id: true, code: true, name: true } },
      },
    });
    await this.audit.write({ user, operationType: 'sample.create', targetTable: 'sample_archive', targetId: String(sample.id), afterData: sample });
    return sample;
  }

  async update(id: string, input: SampleInput, user: AuthUser) {
    const target = this.id(id, '样品编号');
    const before = await this.mustSample(target);
    const code = input.code === undefined ? before.code : text(input.code, 80);
    if (!code) throw new BadRequestException('编号不能为空。');
    if (code !== before.code) {
      const dup = await this.prisma.sampleArchive.findUnique({ where: { code } });
      if (dup && dup.id !== target) throw new BadRequestException('编号已存在。');
    }
    // 仅当请求显式携带 productId 时才更新产品关联，避免部分更新误清空已有关联
    const hasProductId = Object.prototype.hasOwnProperty.call(input, 'productId');
    const link = hasProductId ? await this.resolveProductLink(input) : null;
    const sample = await this.prisma.sampleArchive.update({
      where: { id: target },
      data: {
        code,
        ...(link !== null ? { productId: link.productId, productCode: link.productCode, productName: link.productName } : {}),
        ...(input.customer !== undefined ? { customer: text(input.customer, 200) } : {}),
        ...(input.storageLocation !== undefined ? { storageLocation: text(input.storageLocation, 120) } : {}),
        ...(input.sampleType !== undefined ? { sampleType: sampleType(input.sampleType) } : {}),
        ...(input.remark !== undefined ? { remark: text(input.remark, 1000) } : {}),
        updatedBy: user.username,
      },
      include: {
        photos: { orderBy: { sortOrder: 'asc' } },
        product: { select: { id: true, code: true, name: true } },
      },
    });
    await this.audit.write({ user, operationType: 'sample.update', targetTable: 'sample_archive', targetId: String(target), beforeData: before, afterData: sample });
    return sample;
  }

  async remove(id: string, user: AuthUser) {
    const target = this.id(id, '样品编号');
    const before = await this.mustSample(target);
    // 先删磁盘照片文件，再删记录（sample_photo 由 onDelete: Cascade 级联删除）
    const directory = this.photoDirectory();
    for (const photo of before.photos) {
      const file = join(directory, String(target), photo.fileName);
      await fsPromises.rm(file, { force: true }).catch(() => undefined);
    }
    await fsPromises.rm(join(directory, String(target)), { recursive: true, force: true }).catch(() => undefined);
    await this.prisma.sampleArchive.delete({ where: { id: target } });
    await this.audit.write({ user, operationType: 'sample.delete', targetTable: 'sample_archive', targetId: String(target), beforeData: before });
    return { ok: true };
  }

  private async validateFiles(files: UploadFile[] | undefined) {
    if (!files || files.length === 0) throw new BadRequestException('请选择要上传的照片。');
    if (files.length > MAX_PHOTOS) throw new BadRequestException(`一次最多上传 ${MAX_PHOTOS} 张照片。`);
    for (const file of files) {
      const ext = MIME_EXT[file.mimetype];
      if (!ext) throw new BadRequestException('仅支持 JPG / JPEG / PNG 格式图片。');
      if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('单张照片不能超过 5MB。');
      if (!/\.(jpe?g|png)$/i.test(file.originalname)) throw new BadRequestException('仅支持 .jpg / .jpeg / .png 文件。');
    }
  }

  async addPhotos(id: string, files: UploadFile[] | undefined, user: AuthUser) {
    const target = this.id(id, '样品编号');
    const sample = await this.mustSample(target);
    await this.validateFiles(files);
    const existing = sample.photos.length;
    if (existing + (files?.length ?? 0) > MAX_PHOTOS)
      throw new BadRequestException(`每个样品最多 ${MAX_PHOTOS} 张照片，当前已有 ${existing} 张。`);
    const directory = join(this.photoDirectory(), String(target));
    mkdirSync(directory, { recursive: true });
    const records = [];
    for (const [index, file] of (files ?? []).entries()) {
      const fileName = `${randomUUID()}${MIME_EXT[file.mimetype]}`;
      await fsPromises.writeFile(join(directory, fileName), file.buffer);
      records.push({
        sampleId: target,
        fileName,
        originalName: file.originalname.slice(0, 255),
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        sortOrder: existing + index,
      });
    }
    if (records.length) {
      await this.prisma.samplePhoto.createMany({ data: records });
      await this.audit.write({ user, operationType: 'sample.photo.add', targetTable: 'sample_photo', targetId: String(target), afterData: { added: records.length } });
    }
    return this.mustSample(target);
  }

  async removePhoto(sampleId: string, photoId: string, user: AuthUser) {
    const target = this.id(sampleId, '样品编号');
    const pid = this.id(photoId, '照片编号');
    await this.mustSample(target);
    const photo = await this.prisma.samplePhoto.findUnique({ where: { id: pid } });
    if (!photo || photo.sampleId !== target) throw new NotFoundException('照片不存在。');
    await fsPromises.rm(join(this.photoDirectory(), String(target), photo.fileName), { force: true }).catch(() => undefined);
    await this.prisma.samplePhoto.delete({ where: { id: pid } });
    await this.audit.write({ user, operationType: 'sample.photo.remove', targetTable: 'sample_photo', targetId: String(pid) });
    return { ok: true };
  }

  async servePhoto(sampleId: string, photoId: string, response: Response) {
    const target = this.id(sampleId, '样品编号');
    const pid = this.id(photoId, '照片编号');
    const photo = await this.prisma.samplePhoto.findUnique({ where: { id: pid } });
    if (!photo || photo.sampleId !== target) throw new NotFoundException('照片不存在。');
    const file = join(this.photoDirectory(), String(target), photo.fileName);
    const buffer = await fsPromises.readFile(file);
    response.setHeader('Content-Type', photo.mimeType);
    response.setHeader('Cache-Control', 'no-store');
    response.end(buffer);
  }
}

@Controller('samples')
export class SamplesController {
  constructor(private readonly samples: SampleService) {}

  @RequirePermissions('sample.view')
  @Get()
  list(@Query() query: { keyword?: string; customer?: string; storageLocation?: string; sampleType?: string }) {
    return this.samples.list(query);
  }

  @RequirePermissions('sample.view')
  @Get('product-options')
  productOptions(@Query() query: { keyword?: string; limit?: unknown }) {
    return this.samples.productOptions(query);
  }

  @RequirePermissions('sample.view')
  @Get('customer-options')
  customerOptions() {
    return this.samples.customerOptions();
  }

  @RequirePermissions('sample.view')
  @Get('storage-locations')
  storageLocationOptions() {
    return this.samples.storageLocationOptions();
  }

  @RequirePermissions('sample.create')
  @Post()
  create(@Body() body: SampleInput, @Req() request: AuthRequest) {
    return this.samples.create(body, request.user!);
  }

  @RequirePermissions('sample.update')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: SampleInput, @Req() request: AuthRequest) {
    return this.samples.update(id, body, request.user!);
  }

  @RequirePermissions('sample.delete')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.samples.remove(id, request.user!);
  }

  @RequirePermissions('sample.update')
  @Post(':id/photos')
  @UseInterceptors(FilesInterceptor('files', MAX_PHOTOS, { limits: { files: MAX_PHOTOS, fileSize: MAX_PHOTO_BYTES } }))
  addPhotos(@Param('id') id: string, @UploadedFiles() files: UploadFile[] | undefined, @Req() request: AuthRequest) {
    return this.samples.addPhotos(id, files, request.user!);
  }

  @RequirePermissions('sample.delete')
  @Delete(':id/photos/:photoId')
  removePhoto(@Param('id') id: string, @Param('photoId') photoId: string, @Req() request: AuthRequest) {
    return this.samples.removePhoto(id, photoId, request.user!);
  }

  @RequirePermissions('sample.view')
  @Get(':id/photos/:photoId')
  async servePhoto(@Param('id') id: string, @Param('photoId') photoId: string, @Res() response: Response) {
    await this.samples.servePhoto(id, photoId, response);
  }
}