import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthRequest, AuthUser } from './common';
import { dateOrNull, numberOrNull, RequirePermissions, text } from './common';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

const MATERIAL_TYPES = ['ink', 'solvent', 'additive'] as const;
const FORMULA_STATUS = { draft: 'draft', published: 'published', disabled: 'disabled' } as const;

export type ProductInput = {
  code?: unknown;
  formulaNo?: unknown;
  archiveDate?: unknown;
  name?: unknown;
  customerName?: unknown;
  specification?: unknown;
  substrate?: unknown;
  processNote?: unknown;
  status?: unknown;
};

export type ProductColorInput = {
  name?: unknown;
  colorCode?: unknown;
  printOrder?: unknown;
  targetViscosity?: unknown;
  viscosityUnit?: unknown;
  viscosityMethod?: unknown;
  viscosityTemperature?: unknown;
  targetColorData?: unknown;
  remark?: unknown;
  status?: unknown;
};

export type MaterialInput = {
  code?: unknown;
  name?: unknown;
  materialType?: unknown;
  colorFamily?: unknown;
  manufacturer?: unknown;
  brand?: unknown;
  series?: unknown;
  defaultViscosity?: unknown;
  viscosityUnit?: unknown;
  viscosityMethod?: unknown;
  viscosityTemperature?: unknown;
  density?: unknown;
  unitCost?: unknown;
  isDefaultSolvent?: unknown;
  status?: unknown;
  remark?: unknown;
};

export type FormulaItemInput = {
  materialId?: unknown;
  ratioPart?: unknown;
  sortNo?: unknown;
  componentNote?: unknown;
};

export type FormulaInput = {
  basisType?: unknown;
  targetViscosity?: unknown;
  viscosityUnit?: unknown;
  viscosityMethod?: unknown;
  viscosityTemperature?: unknown;
  applicableConditions?: unknown;
  changeReason?: unknown;
  remark?: unknown;
  items?: unknown;
};

export type AdjustmentInput = {
  productionBatchNo?: unknown;
  targetWeight?: unknown;
  actualViscosityBefore?: unknown;
  actualViscosityAfter?: unknown;
  viscosityUnit?: unknown;
  adjustmentItems?: unknown;
  result?: unknown;
  remark?: unknown;
  residualInk?: unknown;
};

export type QuickFormulaRowInput = {
  sortNo?: unknown;
  colorName?: unknown;
  viscosity?: unknown;
  labL?: unknown;
  labA?: unknown;
  labB?: unknown;
  inkName?: unknown;
  inkBrand?: unknown;
  weightKg?: unknown;
  note?: unknown;
};

export type QuickFormulaInput = {
  formulaNo?: unknown;
  customerName?: unknown;
  productName?: unknown;
  productCode?: unknown;
  archiveDate?: unknown;
  remark?: unknown;
  rows?: unknown;
};

@Injectable()
export class FormulaService {
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

  private decimal(value: unknown) {
    const parsed = numberOrNull(value);
    return parsed === null ? null : parsed;
  }

  private bool(value: unknown) {
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  private async mustProduct(id: bigint) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('产品不存在。');
    return product;
  }

  private async mustColor(id: bigint) {
    const color = await this.prisma.productColor.findUnique({ where: { id } });
    if (!color) throw new NotFoundException('产品专色不存在。');
    return color;
  }

  private async mustMaterial(id: bigint) {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) throw new NotFoundException('配方物料不存在。');
    return material;
  }

  private async mustFormula(id: bigint) {
    const formula = await this.prisma.formula.findUnique({
      where: { id },
      include: { items: { include: { material: true }, orderBy: { sortNo: 'asc' } }, productColor: true },
    });
    if (!formula) throw new NotFoundException('配方不存在。');
    return formula;
  }

  private normalizeItems(input: unknown) {
    if (input === undefined) return undefined;
    if (!Array.isArray(input)) throw new BadRequestException('配方组分格式不正确。');
    return input.map((raw, index) => {
      const item = (raw ?? {}) as FormulaItemInput;
      const materialId = numberOrNull(item.materialId);
      const ratioPart = numberOrNull(item.ratioPart);
      if (materialId === null) throw new BadRequestException(`第 ${index + 1} 个组分缺少物料。`);
      if (ratioPart === null || ratioPart < 0) throw new BadRequestException(`第 ${index + 1} 个组分配比必须是不小于 0 的数值。`);
      return {
        materialId: BigInt(materialId),
        ratioPart,
        sortNo: numberOrNull(item.sortNo) ?? index + 1,
        componentNote: text(item.componentNote, 500),
      };
    });
  }

  async listProducts(query: { keyword?: string }) {
    const keyword = text(query.keyword, 80);
    return this.prisma.product.findMany({
      where: keyword
        ? {
            OR: [
              { code: { contains: keyword } },
              { name: { contains: keyword } },
              { customerName: { contains: keyword } },
              { specification: { contains: keyword } },
            ],
          }
        : {},
      include: { _count: { select: { colors: true } } },
      orderBy: { id: 'desc' },
      take: 200,
    });
  }

  async createProduct(input: ProductInput, user: AuthUser) {
    const code = text(input.code, 80);
    const name = text(input.name, 200);
    if (!code) throw new BadRequestException('产品编码不能为空。');
    if (!name) throw new BadRequestException('产品名称不能为空。');
    if (await this.prisma.product.findUnique({ where: { code } })) throw new BadRequestException('产品编码已存在。');
    const product = await this.prisma.product.create({
      data: {
        code,
        formulaNo: text(input.formulaNo, 80),
        archiveDate: dateOrNull(input.archiveDate),
        name,
        customerName: text(input.customerName, 200),
        specification: text(input.specification, 200),
        substrate: text(input.substrate, 200),
        processNote: text(input.processNote, 1000),
        status: text(input.status, 20) ?? '启用',
        createdBy: user.username,
        updatedBy: user.username,
      },
    });
    await this.audit.write({ user, operationType: 'product.create', targetTable: 'product', targetId: String(product.id), afterData: product });
    return product;
  }

  async quickCreateFormula(input: QuickFormulaInput, user: AuthUser) {
    const productCode = text(input.productCode, 80);
    const productName = text(input.productName, 200);
    if (!productCode) throw new BadRequestException('产品编码不能为空。');
    if (!productName) throw new BadRequestException('产品名称不能为空。');
    if (await this.prisma.product.findUnique({ where: { code: productCode } })) throw new BadRequestException('产品编码已存在。');
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length === 0) throw new BadRequestException('请至少填写一条配方明细。');
    const defaultSolvent = await this.prisma.material.findFirst({ where: { isDefaultSolvent: true, status: '启用' } });

    const { product, colors, materials } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          code: productCode,
          formulaNo: text(input.formulaNo, 80),
          archiveDate: dateOrNull(input.archiveDate),
          name: productName,
          customerName: text(input.customerName, 200),
          processNote: text(input.remark, 1000),
          status: '启用',
          createdBy: user.username,
          updatedBy: user.username,
        },
      });
      const createdColors: any[] = [];
      const createdMaterials: any[] = [];
      for (const [index, raw] of rows.entries()) {
        const row = (raw ?? {}) as QuickFormulaRowInput;
        const colorName = text(row.colorName, 120);
        const inkName = text(row.inkName, 200);
        if (!colorName) throw new BadRequestException(`第 ${index + 1} 行缺少颜色名称。`);
        if (!inkName) throw new BadRequestException(`第 ${index + 1} 行缺少油墨颜色。`);
        const inkBrand = text(row.inkBrand, 120);
        let material = await tx.material.findFirst({
          where: { materialType: 'ink', name: inkName, ...(inkBrand ? { brand: inkBrand } : {}) },
        });
        if (!material) {
          let matCode: string;
          let unique = false;
          do {
            matCode = `MC-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;
            unique = !(await tx.material.findUnique({ where: { code: matCode } }));
          } while (!unique);
          material = await tx.material.create({
            data: {
              code: matCode,
              name: inkName,
              materialType: 'ink',
              colorFamily: colorName,
              brand: inkBrand,
              status: '启用',
              createdBy: user.username,
              updatedBy: user.username,
            },
          });
          createdMaterials.push(material);
        }
        const labL = numberOrNull(row.labL);
        const labA = numberOrNull(row.labA);
        const labB = numberOrNull(row.labB);
        const labData: Record<string, number> = {};
        if (labL !== null) labData.l = labL;
        if (labA !== null) labData.a = labA;
        if (labB !== null) labData.b = labB;
        const color = await tx.productColor.create({
          data: {
            productId: created.id,
            name: colorName,
            printOrder: numberOrNull(row.sortNo) ?? index + 1,
            targetViscosity: this.decimal(row.viscosity),
            targetColorData: Object.keys(labData).length ? labData : undefined,
            remark: text(row.note, 1000),
            status: '启用',
            createdBy: user.username,
            updatedBy: user.username,
          },
        });
        createdColors.push(color);
        const items: Array<{ materialId: bigint; ratioPart: number; sortNo: number; componentNote: string | null; materialTypeSnapshot: string; manufacturerSnapshot: string | null }> = [
          {
            materialId: material.id,
            ratioPart: this.decimal(row.weightKg) ?? 0,
            sortNo: 1,
            componentNote: text(row.note, 500),
            materialTypeSnapshot: 'ink',
            manufacturerSnapshot: inkBrand,
          },
        ];
        if (defaultSolvent && defaultSolvent.id !== material.id) {
          items.push({ materialId: defaultSolvent.id, ratioPart: 0, sortNo: 2, componentNote: '默认溶剂', materialTypeSnapshot: 'solvent', manufacturerSnapshot: null });
        }
        const max = await tx.formula.aggregate({ where: { productColorId: color.id }, _max: { versionNo: true } });
        await tx.formula.create({
          data: {
            productColorId: color.id,
            versionNo: (max._max.versionNo ?? 0) + 1,
            basisType: '份数',
            remark: text(row.note, 1000),
            createdBy: user.username,
            items: { create: items },
          },
        });
      }
      return { product: created, colors: createdColors, materials: createdMaterials };
    });
    await this.audit.write({ user, operationType: 'product.create', targetTable: 'product', targetId: String(product.id), afterData: product });
    for (const color of colors) {
      await this.audit.write({ user, operationType: 'product_color.create', targetTable: 'product_color', targetId: String(color.id), afterData: color });
    }
    for (const material of materials) {
      await this.audit.write({ user, operationType: 'material.create', targetTable: 'material', targetId: String(material.id), afterData: material });
    }
    return product;
  }

  async productDetail(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: this.id(id, '产品编号') },
      include: {
        colors: {
          orderBy: [{ printOrder: 'asc' }, { id: 'asc' }],
          include: {
            formulas: {
              where: { status: FORMULA_STATUS.published },
              take: 1,
              include: { items: { include: { material: true }, orderBy: { sortNo: 'asc' } } },
            },
          },
        },
      },
    });
    if (!product) throw new NotFoundException('产品不存在。');
    return product;
  }

  async updateProduct(id: string, input: ProductInput, user: AuthUser) {
    const target = this.id(id, '产品编号');
    const before = await this.mustProduct(target);
    const code = input.code === undefined ? before.code : text(input.code, 80);
    const name = input.name === undefined ? before.name : text(input.name, 200);
    if (!code) throw new BadRequestException('产品编码不能为空。');
    if (!name) throw new BadRequestException('产品名称不能为空。');
    if (code !== before.code) {
      const dup = await this.prisma.product.findUnique({ where: { code } });
      if (dup && dup.id !== target) throw new BadRequestException('产品编码已存在。');
    }
    const product = await this.prisma.product.update({
      where: { id: target },
      data: {
        code,
        name,
        ...(input.formulaNo !== undefined ? { formulaNo: text(input.formulaNo, 80) } : {}),
        ...(input.archiveDate !== undefined ? { archiveDate: dateOrNull(input.archiveDate) } : {}),
        ...(input.customerName !== undefined ? { customerName: text(input.customerName, 200) } : {}),
        ...(input.specification !== undefined ? { specification: text(input.specification, 200) } : {}),
        ...(input.substrate !== undefined ? { substrate: text(input.substrate, 200) } : {}),
        ...(input.processNote !== undefined ? { processNote: text(input.processNote, 1000) } : {}),
        ...(input.status !== undefined ? { status: text(input.status, 20) ?? before.status } : {}),
        updatedBy: user.username,
      },
    });
    await this.audit.write({ user, operationType: 'product.update', targetTable: 'product', targetId: String(target), beforeData: before, afterData: product });
    return product;
  }
  async addColor(productId: string, input: ProductColorInput, user: AuthUser) {
    const pid = this.id(productId, '产品编号');
    await this.mustProduct(pid);
    const name = text(input.name, 120);
    if (!name) throw new BadRequestException('专色名称不能为空。');
    const color = await this.prisma.productColor.create({
      data: {
        productId: pid,
        name,
        colorCode: text(input.colorCode, 80),
        printOrder: numberOrNull(input.printOrder),
        targetViscosity: this.decimal(input.targetViscosity),
        viscosityUnit: text(input.viscosityUnit, 10) ?? 's',
        viscosityMethod: text(input.viscosityMethod, 120),
        viscosityTemperature: this.decimal(input.viscosityTemperature),
        remark: text(input.remark, 1000),
        status: text(input.status, 20) ?? '启用',
        createdBy: user.username,
        updatedBy: user.username,
      },
    });
    await this.audit.write({ user, operationType: 'product_color.create', targetTable: 'product_color', targetId: String(color.id), afterData: color });
    return color;
  }

  async updateColor(id: string, input: ProductColorInput, user: AuthUser) {
    const target = this.id(id, '专色编号');
    const before = await this.mustColor(target);
    const color = await this.prisma.productColor.update({
      where: { id: target },
      data: {
        ...(input.name !== undefined ? { name: text(input.name, 120) ?? before.name } : {}),
        ...(input.colorCode !== undefined ? { colorCode: text(input.colorCode, 80) } : {}),
        ...(input.printOrder !== undefined ? { printOrder: numberOrNull(input.printOrder) } : {}),
        ...(input.targetViscosity !== undefined ? { targetViscosity: this.decimal(input.targetViscosity) } : {}),
        ...(input.viscosityUnit !== undefined ? { viscosityUnit: text(input.viscosityUnit, 10) ?? 's' } : {}),
        ...(input.viscosityMethod !== undefined ? { viscosityMethod: text(input.viscosityMethod, 120) } : {}),
        ...(input.viscosityTemperature !== undefined ? { viscosityTemperature: this.decimal(input.viscosityTemperature) } : {}),
        ...(input.remark !== undefined ? { remark: text(input.remark, 1000) } : {}),
        ...(input.status !== undefined ? { status: text(input.status, 20) ?? before.status } : {}),
        updatedBy: user.username,
      },
    });
    await this.audit.write({ user, operationType: 'product_color.update', targetTable: 'product_color', targetId: String(target), beforeData: before, afterData: color });
    return color;
  }

  async listMaterials(query: { keyword?: string; type?: string }) {
    const keyword = text(query.keyword, 80);
    const type = text(query.type, 20);
    if (type && !MATERIAL_TYPES.includes(type as (typeof MATERIAL_TYPES)[number])) {
      throw new BadRequestException('物料类型不正确。');
    }
    return this.prisma.material.findMany({
      where: {
        ...(type ? { materialType: type } : {}),
        ...(keyword
          ? {
              OR: [
                { code: { contains: keyword } },
                { name: { contains: keyword } },
                { manufacturer: { contains: keyword } },
                { series: { contains: keyword } },
              ],
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: 500,
    });
  }

  private materialData(input: MaterialInput, user: AuthUser, existing?: { code: string; name: string; materialType: string; status: string }) {
    const materialType = text(input.materialType, 20) ?? existing?.materialType;
    if (!materialType || !MATERIAL_TYPES.includes(materialType as (typeof MATERIAL_TYPES)[number])) {
      throw new BadRequestException('物料类型必须为 ink / solvent / additive。');
    }
    return {
      code: text(input.code, 80) ?? existing?.code,
      name: text(input.name, 200) ?? existing?.name,
      materialType,
      colorFamily: text(input.colorFamily, 120),
      manufacturer: text(input.manufacturer, 200),
      brand: text(input.brand, 120),
      series: text(input.series, 120),
      defaultViscosity: this.decimal(input.defaultViscosity),
      viscosityUnit: text(input.viscosityUnit, 10) ?? 's',
      viscosityMethod: text(input.viscosityMethod, 120),
      viscosityTemperature: this.decimal(input.viscosityTemperature),
      density: this.decimal(input.density),
      unitCost: this.decimal(input.unitCost),
      isDefaultSolvent: this.bool(input.isDefaultSolvent),
      status: text(input.status, 20) ?? existing?.status ?? '启用',
      remark: text(input.remark, 1000),
      updatedBy: user.username,
    };
  }

  private async ensureSingleDefaultSolvent(tx: Pick<PrismaService, 'material'>, data: { materialType: string; isDefaultSolvent: boolean }, excludeId?: bigint) {
    if (data.materialType === 'solvent' && data.isDefaultSolvent) {
      await tx.material.updateMany({
        where: { isDefaultSolvent: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
        data: { isDefaultSolvent: false },
      });
    }
  }

  async createMaterial(input: MaterialInput, user: AuthUser) {
    const data = this.materialData(input, user);
    if (!data.code) throw new BadRequestException('物料编码不能为空。');
    if (!data.name) throw new BadRequestException('物料名称不能为空。');
    if (await this.prisma.material.findUnique({ where: { code: data.code } })) throw new BadRequestException('物料编码已存在。');
    const material = await this.prisma.$transaction(async (tx) => {
      await this.ensureSingleDefaultSolvent(tx, { materialType: data.materialType, isDefaultSolvent: data.isDefaultSolvent });
      return tx.material.create({ data: { ...data, code: data.code!, name: data.name!, createdBy: user.username } });
    });
    await this.audit.write({ user, operationType: 'material.create', targetTable: 'material', targetId: String(material.id), afterData: material });
    return material;
  }

  async updateMaterial(id: string, input: MaterialInput, user: AuthUser) {
    const target = this.id(id, '物料编号');
    const before = await this.mustMaterial(target);
    const data = this.materialData(input, user, before);
    if (!data.code) throw new BadRequestException('物料编码不能为空。');
    if (!data.name) throw new BadRequestException('物料名称不能为空。');
    if (data.code !== before.code) {
      const dup = await this.prisma.material.findUnique({ where: { code: data.code } });
      if (dup && dup.id !== target) throw new BadRequestException('物料编码已存在。');
    }
    const material = await this.prisma.$transaction(async (tx) => {
      await this.ensureSingleDefaultSolvent(tx, { materialType: data.materialType, isDefaultSolvent: data.isDefaultSolvent }, target);
      return tx.material.update({ where: { id: target }, data: { ...data, code: data.code!, name: data.name! } });
    });
    await this.audit.write({ user, operationType: 'material.update', targetTable: 'material', targetId: String(target), beforeData: before, afterData: material });
    return material;
  }
  async listFormulas(productColorId: string) {
    const colorId = this.id(productColorId, '专色编号');
    await this.mustColor(colorId);
    return this.prisma.formula.findMany({
      where: { productColorId: colorId },
      include: {
        items: { include: { material: true }, orderBy: { sortNo: 'asc' } },
        _count: { select: { adjustments: true } },
      },
      orderBy: { versionNo: 'desc' },
    });
  }

  private formulaScalarData(input: FormulaInput) {
    return {
      ...(input.basisType !== undefined ? { basisType: text(input.basisType, 10) ?? '份数' } : {}),
      ...(input.targetViscosity !== undefined ? { targetViscosity: this.decimal(input.targetViscosity) } : {}),
      ...(input.viscosityUnit !== undefined ? { viscosityUnit: text(input.viscosityUnit, 10) ?? 's' } : {}),
      ...(input.viscosityMethod !== undefined ? { viscosityMethod: text(input.viscosityMethod, 120) } : {}),
      ...(input.viscosityTemperature !== undefined ? { viscosityTemperature: this.decimal(input.viscosityTemperature) } : {}),
      ...(input.applicableConditions !== undefined ? { applicableConditions: (input.applicableConditions ?? null) as object } : {}),
      ...(input.changeReason !== undefined ? { changeReason: text(input.changeReason, 1000) } : {}),
      ...(input.remark !== undefined ? { remark: text(input.remark, 1000) } : {}),
    };
  }

  private async checkMaterials(items: Array<{ materialId: bigint; ratioPart: number }>) {
    for (const item of items) {
      const material = await this.prisma.material.findUnique({ where: { id: item.materialId } });
      if (!material) throw new BadRequestException('配方中存在无效物料。');
      if (material.status !== '启用') throw new BadRequestException(`物料 ${material.name} 已停用，不能用于新配方。`);
    }
  }

  async createDraft(productColorId: string, input: FormulaInput, user: AuthUser) {
    const colorId = this.id(productColorId, '专色编号');
    await this.mustColor(colorId);
    const items = this.normalizeItems(input.items) ?? [];
    const defaultSolvent = await this.prisma.material.findFirst({ where: { isDefaultSolvent: true, status: '启用' } });
    if (defaultSolvent && !items.some((item) => item.materialId === defaultSolvent.id)) {
      items.push({ materialId: defaultSolvent.id, ratioPart: 0, sortNo: items.length + 1, componentNote: '默认溶剂' });
    }
    await this.checkMaterials(items);
    const max = await this.prisma.formula.aggregate({ where: { productColorId: colorId }, _max: { versionNo: true } });
    const formula = await this.prisma.formula.create({
      data: {
        productColorId: colorId,
        versionNo: (max._max.versionNo ?? 0) + 1,
        ...this.formulaScalarData(input),
        createdBy: user.username,
        items: { create: items },
      },
      include: { items: { include: { material: true }, orderBy: { sortNo: 'asc' } } },
    });
    await this.audit.write({ user, operationType: 'formula.create', targetTable: 'formula', targetId: String(formula.id), afterData: formula });
    return formula;
  }

  async updateDraft(id: string, input: FormulaInput, user: AuthUser) {
    const target = this.id(id, '配方编号');
    const before = await this.mustFormula(target);
    if (before.status !== FORMULA_STATUS.draft) throw new BadRequestException('仅草稿状态可编辑，请复制为新版本。');
    const items = this.normalizeItems(input.items);
    if (items) await this.checkMaterials(items);
    const formula = await this.prisma.$transaction(async (tx) => {
      if (items) await tx.formulaItem.deleteMany({ where: { formulaId: target } });
      const updated = await tx.formula.update({
        where: { id: target },
        data: { ...this.formulaScalarData(input), ...(items ? { items: { create: items } } : {}) },
      });
      return updated;
    });
    const after = await this.mustFormula(target);
    await this.audit.write({ user, operationType: 'formula.update', targetTable: 'formula', targetId: String(target), beforeData: before, afterData: after });
    return after;
  }

  async clone(id: string, user: AuthUser) {
    const source = await this.mustFormula(this.id(id, '配方编号'));
    const max = await this.prisma.formula.aggregate({ where: { productColorId: source.productColorId }, _max: { versionNo: true } });
    const formula = await this.prisma.formula.create({
      data: {
        productColorId: source.productColorId,
        versionNo: (max._max.versionNo ?? 0) + 1,
        basisType: source.basisType,
        targetViscosity: source.targetViscosity,
        viscosityUnit: source.viscosityUnit,
        viscosityMethod: source.viscosityMethod,
        viscosityTemperature: source.viscosityTemperature,
        applicableConditions: source.applicableConditions === null ? undefined : (source.applicableConditions as object),
        remark: source.remark,
        createdBy: user.username,
        items: {
          create: source.items.map((item) => ({
            materialId: item.materialId,
            ratioPart: item.ratioPart,
            sortNo: item.sortNo,
            componentNote: item.componentNote,
          })),
        },
      },
      include: { items: { include: { material: true }, orderBy: { sortNo: 'asc' } } },
    });
    await this.audit.write({ user, operationType: 'formula.clone', targetTable: 'formula', targetId: String(formula.id), remark: `复制自 V${source.versionNo}`, afterData: formula });
    return formula;
  }

  async publish(id: string, user: AuthUser) {
    const target = this.id(id, '配方编号');
    const before = await this.mustFormula(target);
    if (before.status !== FORMULA_STATUS.draft) throw new BadRequestException('仅草稿状态可发布。');
    if (before.items.length === 0) throw new BadRequestException('配方无组分，禁止发布。');
    for (const item of before.items) {
      if (Number(item.ratioPart) <= 0) throw new BadRequestException(`组分 ${item.material.name} 的配比必须为有效正数。`);
    }
    if (!before.items.some((item) => item.material.materialType === 'ink')) throw new BadRequestException('配方至少需要 1 种油墨。');
    const defaultSolvent = await this.prisma.material.findFirst({ where: { isDefaultSolvent: true } });
    if (defaultSolvent) {
      const solventItem = before.items.find((item) => item.materialId === defaultSolvent.id);
      if (!solventItem || Number(solventItem.ratioPart) <= 0) {
        throw new BadRequestException(`默认溶剂 ${defaultSolvent.name} 必须包含在配方中且有有效份数。`);
      }
    }
    const totalParts = before.items.reduce((sum, item) => sum + Number(item.ratioPart), 0);
    const formula = await this.prisma.$transaction(async (tx) => {
      await tx.formula.updateMany({
        where: { productColorId: before.productColorId, status: FORMULA_STATUS.published, id: { not: target } },
        data: { status: FORMULA_STATUS.disabled },
      });
      for (const item of before.items) {
        const viscosity = item.material.defaultViscosity === null ? null : `${item.material.defaultViscosity} ${item.material.viscosityUnit}${item.material.viscosityMethod ? ` / ${item.material.viscosityMethod}` : ''}${item.material.viscosityTemperature === null ? '' : ` / ${item.material.viscosityTemperature}℃`}`;
        await tx.formulaItem.update({
          where: { id: item.id },
          data: {
            ratioPercent: (Number(item.ratioPart) / totalParts) * 100,
            materialTypeSnapshot: item.material.materialType,
            manufacturerSnapshot: item.material.manufacturer,
            viscositySnapshot: viscosity,
          },
        });
      }
      return tx.formula.update({
        where: { id: target },
        data: { status: FORMULA_STATUS.published, publishedBy: user.username, publishedAt: new Date() },
      });
    });
    await this.audit.write({ user, operationType: 'formula.publish', targetTable: 'formula', targetId: String(target), beforeData: before, afterData: formula });
    return this.mustFormula(target);
  }

  async disable(id: string, user: AuthUser) {
    const target = this.id(id, '配方编号');
    const before = await this.mustFormula(target);
    if (before.status !== FORMULA_STATUS.published) throw new BadRequestException('仅已发布版本可停用。');
    const formula = await this.prisma.formula.update({ where: { id: target }, data: { status: FORMULA_STATUS.disabled } });
    await this.audit.write({ user, operationType: 'formula.disable', targetTable: 'formula', targetId: String(target), beforeData: before, afterData: formula });
    return formula;
  }

  async calculate(id: string, body: { targetWeight?: unknown }) {
    const formula = await this.mustFormula(this.id(id, '配方编号'));
    const targetWeight = numberOrNull(body.targetWeight);
    if (targetWeight === null || targetWeight <= 0) throw new BadRequestException('目标重量必须为有效正数。');
    const totalParts = formula.items.reduce((sum, item) => sum + Number(item.ratioPart), 0);
    if (totalParts <= 0) throw new BadRequestException('配方总份数为 0，无法计算。');
    return {
      formulaId: String(formula.id),
      versionNo: formula.versionNo,
      basisType: formula.basisType,
      totalParts,
      targetViscosity: {
        value: formula.targetViscosity === null ? null : Number(formula.targetViscosity),
        unit: formula.viscosityUnit,
        method: formula.viscosityMethod,
        temperature: formula.viscosityTemperature === null ? null : Number(formula.viscosityTemperature),
      },
      items: formula.items.map((item) => {
        const part = Number(item.ratioPart);
        return {
          materialCode: item.material.code,
          name: item.material.name,
          materialType: item.materialTypeSnapshot ?? item.material.materialType,
          manufacturer: item.manufacturerSnapshot ?? item.material.manufacturer,
          ratioPart: part,
          ratioPercent: Math.round((part / totalParts) * 100 * 10000) / 10000,
          weightKg: Math.round(((targetWeight * part) / totalParts) * 1000) / 1000,
        };
      }),
    };
  }
  private normalizeAdjustmentItems(input: unknown) {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) throw new BadRequestException('调色追加明细格式不正确。');
    return input.map((raw, index) => {
      const item = (raw ?? {}) as { materialId?: unknown; materialName?: unknown; weightKg?: unknown; note?: unknown };
      const weightKg = numberOrNull(item.weightKg);
      const materialId = numberOrNull(item.materialId);
      const materialName = text(item.materialName, 200);
      if (weightKg === null || weightKg <= 0) throw new BadRequestException(`第 ${index + 1} 条追加明细的重量必须为有效正数。`);
      if (materialId === null && !materialName) throw new BadRequestException(`第 ${index + 1} 条追加明细缺少物料。`);
      return { materialId, materialName, weightKg, note: text(item.note, 500) };
    });
  }

  async listAdjustments(formulaId: string) {
    const target = this.id(formulaId, '配方编号');
    await this.mustFormula(target);
    return this.prisma.formulaAdjustment.findMany({
      where: { formulaId: target },
      include: {
        residualInk: { select: { id: true, storageLocation: true, weightKg: true, status: true } },
        promotedFormula: { select: { id: true, versionNo: true, status: true } },
      },
      orderBy: { id: 'desc' },
    });
  }

  async createAdjustment(formulaId: string, input: AdjustmentInput, user: AuthUser) {
    const target = this.id(formulaId, '配方编号');
    const formula = await this.mustFormula(target);
    const items = this.normalizeAdjustmentItems(input.adjustmentItems);
    const inkInput = (input.residualInk ?? null) as {
      storageLocation?: unknown;
      weightKg?: unknown;
      lStar?: unknown;
      aStar?: unknown;
      bStar?: unknown;
      colorFamily?: unknown;
      note2?: unknown;
      note3?: unknown;
      inboundDate?: unknown;
    } | null;
    if (inkInput) {
      const location = text(inkInput.storageLocation, 120);
      if (!location) throw new BadRequestException('余墨入库必须指定库位。');
      if (await this.prisma.residualInk.findUnique({ where: { storageLocation: location } })) {
        throw new BadRequestException(`库位 ${location} 已存在库存记录。`);
      }
    }
    const adjustment = await this.prisma.$transaction(async (tx) => {
      let inkId: bigint | null = null;
      if (inkInput) {
        const ink = await tx.residualInk.create({
          data: {
            storageLocation: text(inkInput.storageLocation, 120)!,
            weightKg: this.decimal(inkInput.weightKg),
            lStar: this.decimal(inkInput.lStar),
            aStar: this.decimal(inkInput.aStar),
            bStar: this.decimal(inkInput.bStar),
            colorFamily: text(inkInput.colorFamily, 120),
            note2: text(inkInput.note2, 500),
            note3: text(inkInput.note3, 500),
            inboundDate: dateOrNull(inkInput.inboundDate) ?? new Date(),
            status: '在库',
            formulaId: formula.id,
            productId: formula.productColor.productId,
            createdBy: user.username,
            updatedBy: user.username,
          },
        });
        inkId = ink.id;
      }
      return tx.formulaAdjustment.create({
        data: {
          formulaId: target,
          productionBatchNo: text(input.productionBatchNo, 80),
          targetWeight: this.decimal(input.targetWeight),
          actualViscosityBefore: this.decimal(input.actualViscosityBefore),
          actualViscosityAfter: this.decimal(input.actualViscosityAfter),
          viscosityUnit: text(input.viscosityUnit, 10) ?? 's',
          adjustmentItems: items as object,
          result: text(input.result, 40),
          remark: text(input.remark, 1000),
          createdBy: user.username,
          residualInkId: inkId,
        },
        include: { residualInk: { select: { id: true, storageLocation: true, weightKg: true, status: true } } },
      });
    });
    await this.audit.write({ user, operationType: 'formula.adjustment.create', targetTable: 'formula_adjustment', targetId: String(adjustment.id), afterData: adjustment });
    return adjustment;
  }

  async promote(adjustmentId: string, user: AuthUser) {
    const target = this.id(adjustmentId, '调色记录编号');
    const adjustment = await this.prisma.formulaAdjustment.findUnique({
      where: { id: target },
      include: { formula: { include: { items: true } } },
    });
    if (!adjustment) throw new NotFoundException('调色记录不存在。');
    if (adjustment.promotedFormulaId) throw new BadRequestException('该记录已沉淀为新配方版本。');
    const baseItems = adjustment.formula.items.map((item) => ({
      materialId: item.materialId,
      ratioPart: Number(item.ratioPart),
      sortNo: item.sortNo,
      componentNote: item.componentNote,
    }));
    const totalParts = baseItems.reduce((sum, item) => sum + item.ratioPart, 0);
    const targetWeight = adjustment.targetWeight === null ? null : Number(adjustment.targetWeight);
    const additions = Array.isArray(adjustment.adjustmentItems) ? (adjustment.adjustmentItems as Array<{ materialId?: number | string | null; weightKg?: number | string }>) : [];
    for (const addition of additions) {
      const materialId = numberOrNull(addition.materialId);
      const weightKg = numberOrNull(addition.weightKg);
      if (materialId === null || weightKg === null || weightKg <= 0) continue;
      const extraPart = totalParts > 0 && targetWeight && targetWeight > 0 ? (weightKg * totalParts) / targetWeight : weightKg;
      const existing = baseItems.find((item) => item.materialId === BigInt(materialId));
      if (existing) existing.ratioPart += extraPart;
      else baseItems.push({ materialId: BigInt(materialId), ratioPart: extraPart, sortNo: baseItems.length + 1, componentNote: '调色追加' });
    }
    const max = await this.prisma.formula.aggregate({ where: { productColorId: adjustment.formula.productColorId }, _max: { versionNo: true } });
    const formula = await this.prisma.$transaction(async (tx) => {
      const created = await tx.formula.create({
        data: {
          productColorId: adjustment.formula.productColorId,
          versionNo: (max._max.versionNo ?? 0) + 1,
          basisType: adjustment.formula.basisType,
          targetViscosity: adjustment.actualViscosityAfter ?? adjustment.formula.targetViscosity,
          viscosityUnit: adjustment.viscosityUnit,
          viscosityMethod: adjustment.formula.viscosityMethod,
          viscosityTemperature: adjustment.formula.viscosityTemperature,
          changeReason: `由调色记录 #${target} 沉淀`,
          remark: adjustment.remark,
          createdBy: user.username,
          items: { create: baseItems },
        },
        include: { items: { include: { material: true }, orderBy: { sortNo: 'asc' } } },
      });
      await tx.formulaAdjustment.update({ where: { id: target }, data: { promotedFormulaId: created.id } });
      return created;
    });
    await this.audit.write({ user, operationType: 'formula.promote', targetTable: 'formula', targetId: String(formula.id), remark: `调色记录 #${target} 沉淀为 V${formula.versionNo}`, afterData: formula });
    return formula;
  }
}

@Controller('products')
export class ProductsController {
  constructor(private readonly formulas: FormulaService) {}

  @RequirePermissions('formula.view')
  @Get()
  list(@Query() query: { keyword?: string }) {
    return this.formulas.listProducts(query);
  }

  @RequirePermissions('formula.edit')
  @Post()
  create(@Body() body: ProductInput, @Req() request: AuthRequest) {
    return this.formulas.createProduct(body, request.user!);
  }

  @RequirePermissions('formula.edit')
  @Post('formula')
  quickCreate(@Body() body: QuickFormulaInput, @Req() request: AuthRequest) {
    return this.formulas.quickCreateFormula(body, request.user!);
  }

  @RequirePermissions('formula.view')
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.formulas.productDetail(id);
  }

  @RequirePermissions('formula.edit')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ProductInput, @Req() request: AuthRequest) {
    return this.formulas.updateProduct(id, body, request.user!);
  }

  @RequirePermissions('formula.edit')
  @Post(':id/colors')
  addColor(@Param('id') id: string, @Body() body: ProductColorInput, @Req() request: AuthRequest) {
    return this.formulas.addColor(id, body, request.user!);
  }
}

@Controller('product-colors')
export class ProductColorsController {
  constructor(private readonly formulas: FormulaService) {}

  @RequirePermissions('formula.edit')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ProductColorInput, @Req() request: AuthRequest) {
    return this.formulas.updateColor(id, body, request.user!);
  }

  @RequirePermissions('formula.view')
  @Get(':id/formulas')
  formulasList(@Param('id') id: string) {
    return this.formulas.listFormulas(id);
  }

  @RequirePermissions('formula.edit')
  @Post(':id/formulas')
  createDraft(@Param('id') id: string, @Body() body: FormulaInput, @Req() request: AuthRequest) {
    return this.formulas.createDraft(id, body, request.user!);
  }
}

@Controller('materials')
export class MaterialsController {
  constructor(private readonly formulas: FormulaService) {}

  @RequirePermissions('formula.view')
  @Get()
  list(@Query() query: { keyword?: string; type?: string }) {
    return this.formulas.listMaterials(query);
  }

  @RequirePermissions('material.edit')
  @Post()
  create(@Body() body: MaterialInput, @Req() request: AuthRequest) {
    return this.formulas.createMaterial(body, request.user!);
  }

  @RequirePermissions('material.edit')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: MaterialInput, @Req() request: AuthRequest) {
    return this.formulas.updateMaterial(id, body, request.user!);
  }
}

@Controller('formulas')
export class FormulasController {
  constructor(private readonly formulas: FormulaService) {}

  @RequirePermissions('formula.edit')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: FormulaInput, @Req() request: AuthRequest) {
    return this.formulas.updateDraft(id, body, request.user!);
  }

  @RequirePermissions('formula.edit')
  @Post(':id/clone')
  clone(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.formulas.clone(id, request.user!);
  }

  @RequirePermissions('formula.publish')
  @Post(':id/publish')
  publish(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.formulas.publish(id, request.user!);
  }

  @RequirePermissions('formula.publish')
  @Post(':id/disable')
  disable(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.formulas.disable(id, request.user!);
  }

  @RequirePermissions('formula.view')
  @Post(':id/calculate')
  calculate(@Param('id') id: string, @Body() body: { targetWeight?: unknown }) {
    return this.formulas.calculate(id, body);
  }

  @RequirePermissions('formula.view')
  @Get(':id/adjustments')
  adjustments(@Param('id') id: string) {
    return this.formulas.listAdjustments(id);
  }

  @RequirePermissions('formula.edit')
  @Post(':id/adjustments')
  createAdjustment(@Param('id') id: string, @Body() body: AdjustmentInput, @Req() request: AuthRequest) {
    return this.formulas.createAdjustment(id, body, request.user!);
  }
}

@Controller('adjustments')
export class AdjustmentsController {
  constructor(private readonly formulas: FormulaService) {}

  @RequirePermissions('formula.edit')
  @Post(':id/promote')
  promote(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.formulas.promote(id, request.user!);
  }
}