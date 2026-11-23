import { Module } from '@nestjs/common';
import { DevProbeRepository } from './application/dev-probe.repository.js';
import { DevProbeService } from './application/dev-probe.service.js';
import { PrismaDevProbeRepository } from './infrastructure/prisma-dev-probe.repository.js';
import { DevProbeController } from './interface/dev-probe.controller.js';

/**
 * Recurso técnico `dev-probe` (FR-017; T040–T042). NO productivo: solo se registra a través de `DEV_ONLY_MODULES`, que
 * `AppModule` incluye únicamente en local/testing con el contexto técnico habilitado (FR-040, R-05).
 */
@Module({
  controllers: [DevProbeController],
  providers: [DevProbeService, { provide: DevProbeRepository, useClass: PrismaDevProbeRepository }],
})
export class DevProbeModule {}
