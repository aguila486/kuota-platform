import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { DevProbeRepository } from './application/dev-probe.repository.js';
import { DevProbeService } from './application/dev-probe.service.js';
import { PrismaDevProbeRepository } from './infrastructure/prisma-dev-probe.repository.js';
import { DevProbeController } from './interface/dev-probe.controller.js';

/**
 * Recurso técnico `dev-probe` (FR-017; T040–T042). NO productivo: solo se registra a través de `DEV_ONLY_MODULES`, que
 * `AppModule` incluye únicamente en local/testing con el contexto técnico habilitado (FR-040, R-05).
 */
@Module({
  imports: [AuditModule, IdempotencyModule],
  controllers: [DevProbeController],
  providers: [DevProbeService, { provide: DevProbeRepository, useClass: PrismaDevProbeRepository }],
})
export class DevProbeModule {}
