import { Injectable } from '@nestjs/common';
import type { AuthRequest, AuthUser } from './common';
import { jsonSafe } from './common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: {
    user?: AuthUser | null;
    request?: AuthRequest | null;
    username?: string | null;
    operationType: string;
    targetTable?: string | null;
    targetId?: string | null;
    beforeData?: unknown;
    afterData?: unknown;
    remark?: string | null;
  }) {
    await this.prisma.operationLog.create({
      data: {
        userId: input.user?.id ? BigInt(input.user.id) : null,
        username: input.user?.username ?? input.username ?? null,
        operationType: input.operationType,
        targetTable: input.targetTable ?? null,
        targetId: input.targetId ?? null,
        beforeData: input.beforeData === undefined ? undefined : (jsonSafe(input.beforeData) as object),
        afterData: input.afterData === undefined ? undefined : (jsonSafe(input.afterData) as object),
        ipAddress: input.request?.ip ?? null,
        remark: input.remark ?? null,
      },
    });
  }
}
