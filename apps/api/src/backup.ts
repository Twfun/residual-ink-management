import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { AuthRequest, AuthUser } from './common';
import { jsonSafe, RequirePermissions } from './common';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

type BackupDocument = {
  format: 'residual-ink-management-backup';
  version: 1;
  createdAt: string;
  tables: Record<string, unknown[]>;
};
type UploadFile = { buffer: Buffer; originalname: string };

@Injectable()
export class BackupService {
  private readonly pending = new Map<
    string,
    { document: BackupDocument; sha256: string; fileName: string; expiresAt: number }
  >();
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return { rows: await this.prisma.backupJob.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) };
  }

  async create(user: AuthUser, request: AuthRequest) {
    const job = await this.prisma.backupJob.create({
      data: { jobType: 'backup', status: 'running', createdBy: user.username },
    });
    try {
      const document = await this.document();
      const content = JSON.stringify(jsonSafe(document));
      const sha256 = createHash('sha256').update(content).digest('hex');
      const directory = this.backupDirectory();
      await mkdir(directory, { recursive: true });
      const fileName = `ResidualInkManagement_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      await writeFile(join(directory, fileName), content, 'utf8');
      await this.prisma.backupJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          fileName,
          fileSize: BigInt(Buffer.byteLength(content)),
          sha256,
          finishedAt: new Date(),
        },
      });
      await this.audit.write({
        user,
        request,
        operationType: 'backup.create',
        targetTable: 'backup_job',
        targetId: job.id.toString(),
        afterData: { fileName, sha256 },
      });
      return { id: job.id.toString(), fileName, sha256, directory };
    } catch (error) {
      await this.prisma.backupJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async preview(file: UploadFile | undefined, user: AuthUser, request: AuthRequest) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择备份文件。');
    const document = parseBackup(file.buffer);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const token = randomUUID();
    this.pending.set(token, {
      document,
      sha256,
      fileName: basename(file.originalname),
      expiresAt: Date.now() + 10 * 60_000,
    });
    const counts = Object.fromEntries(Object.entries(document.tables).map(([name, rows]) => [name, rows.length]));
    await this.audit.write({
      user,
      request,
      operationType: 'backup.restore.preview',
      targetTable: 'backup_job',
      targetId: token,
      afterData: { fileName: file.originalname, sha256, counts },
    });
    return { token, sha256, fileName: file.originalname, counts, expiresAt: new Date(Date.now() + 10 * 60_000) };
  }

  async restore(tokenValue: unknown, user: AuthUser, request: AuthRequest) {
    const token = String(tokenValue ?? '');
    const pending = this.pending.get(token);
    if (!pending || pending.expiresAt < Date.now())
      throw new BadRequestException('恢复预检已失效，请重新选择备份文件。');
    const job = await this.prisma.backupJob.create({
      data: {
        jobType: 'restore',
        status: 'running',
        fileName: pending.fileName,
        sha256: pending.sha256,
        createdBy: user.username,
      },
    });
    try {
      await this.restoreDocument(pending.document);
      await this.prisma.backupJob.update({
        where: { id: job.id },
        data: { status: 'completed', finishedAt: new Date() },
      });
      this.pending.delete(token);
      await this.audit.write({
        user,
        request,
        operationType: 'backup.restore.commit',
        targetTable: 'backup_job',
        targetId: job.id.toString(),
        afterData: { fileName: pending.fileName, sha256: pending.sha256 },
      });
      return { ok: true, id: job.id.toString() };
    } catch (error) {
      await this.prisma.backupJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async document(): Promise<BackupDocument> {
    const [
      users,
      attempts,
      roles,
      permissions,
      rolePermissions,
      inventory,
      outbound,
      measurements,
      imports,
      logs,
      config,
      backups,
    ] = await Promise.all([
      this.prisma.userAccount.findMany(),
      this.prisma.loginAttempt.findMany(),
      this.prisma.role.findMany(),
      this.prisma.permission.findMany(),
      this.prisma.rolePermission.findMany(),
      this.prisma.residualInk.findMany({ where: { deletedAt: null } }),
      this.prisma.outboundRecord.findMany(),
      this.prisma.colorMeasurement.findMany({ where: { deletedAt: null } }),
      this.prisma.importJob.findMany(),
      this.prisma.operationLog.findMany(),
      this.prisma.desktopConfig.findMany(),
      this.prisma.backupJob.findMany(),
    ]);
    return {
      format: 'residual-ink-management-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      tables: {
        users,
        attempts,
        roles,
        permissions,
        rolePermissions,
        inventory,
        outbound,
        measurements,
        imports,
        logs,
        config,
        backups,
      },
    };
  }

  private async restoreDocument(document: BackupDocument) {
    const t = document.tables;
    await this.prisma.$transaction(async (tx) => {
      await tx.operationLog.deleteMany();
      await tx.outboundRecord.deleteMany();
      await tx.colorMeasurement.deleteMany();
      await tx.importJob.deleteMany();
      await tx.residualInk.deleteMany();
      await tx.desktopConfig.deleteMany();
      await tx.rolePermission.deleteMany();
      await tx.permission.deleteMany();
      await tx.loginAttempt.deleteMany();
      await tx.userAccount.deleteMany();
      await tx.role.deleteMany();
      if (t.roles?.length) await tx.role.createMany({ data: t.roles as never });
      if (t.permissions?.length) await tx.permission.createMany({ data: t.permissions as never });
      if (t.rolePermissions?.length) await tx.rolePermission.createMany({ data: t.rolePermissions as never });
      if (t.users?.length) await tx.userAccount.createMany({ data: t.users as never });
      if (t.attempts?.length) await tx.loginAttempt.createMany({ data: t.attempts as never });
      if (t.inventory?.length) await tx.residualInk.createMany({ data: t.inventory as never });
      if (t.outbound?.length) await tx.outboundRecord.createMany({ data: t.outbound as never });
      if (t.measurements?.length) await tx.colorMeasurement.createMany({ data: t.measurements as never });
      if (t.imports?.length) await tx.importJob.createMany({ data: t.imports as never });
      if (t.config?.length) await tx.desktopConfig.createMany({ data: t.config as never });
      if (t.logs?.length) await tx.operationLog.createMany({ data: t.logs as never });
    });
  }

  private backupDirectory() {
    return resolve(
      process.env.RIM_BACKUP_DIR ||
        join(process.env.LOCALAPPDATA || process.cwd(), 'ResidualInkManagementRuntime', 'data', 'backups'),
    );
  }
}

function parseBackup(buffer: Buffer): BackupDocument {
  let parsed: BackupDocument;
  try {
    parsed = JSON.parse(buffer.toString('utf8')) as BackupDocument;
  } catch {
    throw new BadRequestException('备份文件不是有效 JSON。');
  }
  if (
    parsed?.format !== 'residual-ink-management-backup' ||
    parsed.version !== 1 ||
    !parsed.tables ||
    typeof parsed.tables !== 'object'
  )
    throw new BadRequestException('备份文件格式不受支持。');
  for (const value of Object.values(parsed.tables))
    if (!Array.isArray(value)) throw new BadRequestException('备份文件表数据无效。');
  return parsed;
}

@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}
  @RequirePermissions('backup.manage') @Get() list() {
    return this.backup.list();
  }
  @RequirePermissions('backup.manage') @Post() create(@Req() request: AuthRequest) {
    return this.backup.create(request.user!, request);
  }
  @RequirePermissions('backup.manage')
  @Post('preview-restore')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  preview(@UploadedFile() file: UploadFile | undefined, @Req() request: AuthRequest) {
    return this.backup.preview(file, request.user!, request);
  }
  @RequirePermissions('backup.manage') @Post('restore') restore(
    @Body() body: { token?: unknown },
    @Req() request: AuthRequest,
  ) {
    return this.backup.restore(body.token, request.user!, request);
  }
}
