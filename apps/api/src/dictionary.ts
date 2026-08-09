import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from './common';
import { PrismaService } from './prisma.service';

// type 路径片段 -> Prisma 模型
const TYPE_TO_MODEL: Record<string, ModelKey> = {
  'ink-colors': 'inkColor',
  'ink-manufacturers': 'inkManufacturer',
  customers: 'customer',
};

type ModelKey = 'inkColor' | 'inkManufacturer' | 'customer';

// 各模型用于关键词检索的字段
const KEYWORD_FIELDS: Record<ModelKey, string[]> = {
  inkColor: ['name', 'colorCode'],
  inkManufacturer: ['name'],
  customer: ['name', 'code'],
};

// 各模型排序规则（油墨颜色含 sortOrder，其余按名称）
const ORDER_BY: Record<ModelKey, Array<Record<string, string>>> = {
  inkColor: [{ sortOrder: 'asc' }, { id: 'asc' }],
  inkManufacturer: [{ name: 'asc' }],
  customer: [{ name: 'asc' }],
};

@Injectable()
export class DictionaryService {
  constructor(private readonly prisma: PrismaService) {}

  private delegate(model: ModelKey) {
    return this.prisma[model] as any;
  }

  async list(model: ModelKey, keyword?: string) {
    const where = keyword
      ? { OR: KEYWORD_FIELDS[model].map((field) => ({ [field]: { contains: keyword } })) }
      : {};
    const rows = await this.delegate(model).findMany({
      where,
      orderBy: ORDER_BY[model],
    });
    return { rows };
  }

  // 供下拉选择使用的精简选项列表
  async options(model: ModelKey) {
    const rows = await this.delegate(model).findMany({
      orderBy: ORDER_BY[model],
      select: { id: true, name: true },
    });
    return { rows: rows.map((row: any) => ({ value: row.name, label: row.name, id: row.id.toString() })) };
  }

  async create(model: ModelKey, dto: Record<string, unknown>) {
    const name = dto.name;
    if (name === undefined || name === null || String(name).trim() === '')
      throw new BadRequestException('名称不能为空。');
    const data: Record<string, unknown> = { ...dto, name: String(name).trim() };
    // 油墨颜色新增时自动分配排序号（当前最大 sortOrder + 1）
    if (model === 'inkColor' && (data.sortOrder === undefined || data.sortOrder === null)) {
      const max = await this.delegate(model).aggregate({ _max: { sortOrder: true } });
      data.sortOrder = (max._max.sortOrder ?? 0) + 1;
    }
    const row = await this.delegate(model).create({ data });
    return row;
  }

  async update(model: ModelKey, id: number, dto: Record<string, unknown>) {
    const existing = await this.delegate(model).findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('记录不存在或已被删除。');
    if (dto.name !== undefined && String(dto.name).trim() === '')
      throw new BadRequestException('名称不能为空。');
    const row = await this.delegate(model).update({
      where: { id },
      data: dto.name !== undefined ? { ...dto, name: String(dto.name).trim() } : dto,
    });
    return row;
  }

  async remove(model: ModelKey, id: number) {
    const existing = await this.delegate(model).findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('记录不存在或已被删除。');
    await this.delegate(model).delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('dictionary')
export class DictionaryController {
  constructor(private readonly dictionary: DictionaryService) {}

  private resolve(type: string): ModelKey {
    const model = TYPE_TO_MODEL[type];
    if (!model) throw new BadRequestException('不支持的字典类型。');
    return model;
  }

  // 只读选项接口：供配方、出入库等模块的下拉选择引用
  @RequirePermissions('formula.view')
  @Get(':type/options')
  options(@Param('type') type: string) {
    const model = this.resolve(type);
    return this.dictionary.options(model);
  }

  @RequirePermissions('dictionary.manage')
  @Get(':type')
  list(@Param('type') type: string, @Query('keyword') keyword?: string) {
    return this.dictionary.list(this.resolve(type), keyword);
  }

  @RequirePermissions('dictionary.manage')
  @Post(':type')
  create(@Param('type') type: string, @Body() body: Record<string, unknown>) {
    return this.dictionary.create(this.resolve(type), body);
  }

  @RequirePermissions('dictionary.manage')
  @Put(':type/:id')
  update(@Param('type') type: string, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.dictionary.update(this.resolve(type), id, body);
  }

  @RequirePermissions('dictionary.manage')
  @Delete(':type/:id')
  remove(@Param('type') type: string, @Param('id', ParseIntPipe) id: number) {
    return this.dictionary.remove(this.resolve(type), id);
  }
}