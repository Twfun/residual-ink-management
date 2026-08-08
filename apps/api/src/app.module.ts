import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AdministrationController, AdministrationService } from './administration';
import { AuditService } from './audit.service';
import { AuthController, AuthService } from './auth';
import { BackupController, BackupService } from './backup';
import { JsonSafeInterceptor, Public } from './common';
import { DashboardController, DashboardService } from './dashboard';
import { ExcelExportController, ExcelExportService, ExcelImportController, ExcelImportService } from './excel';
import { AdjustmentsController, FormulasController, FormulaService, MaterialsController, ProductColorsController, ProductsController } from './formula';
import { JwtAuthGuard, PermissionsGuard } from './guards';
import { InventoryController, InventoryService } from './inventory';
import { MatchController, MatchService } from './match';
import { OutboundController, OutboundService } from './outbound';
import { PrismaService } from './prisma.service';
import { StatisticsController, StatisticsService } from './statistics';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true, product: 'Residual Ink Management', version: '1.3.0' };
  }
}

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-this-local-residual-ink-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    InventoryController,
    OutboundController,
    MatchController,
    ExcelImportController,
    ExcelExportController,
    DashboardController,
    StatisticsController,
    AdministrationController,
    BackupController,
    ProductsController,
    ProductColorsController,
    MaterialsController,
    FormulasController,
    AdjustmentsController,
  ],
  providers: [
    PrismaService,
    AuditService,
    AuthService,
    InventoryService,
    OutboundService,
    MatchService,
    ExcelImportService,
    ExcelExportService,
    DashboardService,
    StatisticsService,
    AdministrationService,
    BackupService,
    FormulaService,
    JwtAuthGuard,
    PermissionsGuard,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: JsonSafeInterceptor },
  ],
})
export class AppModule {}
