import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DatabaseProbeModule } from '../../common/database/database-probe.module.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { HealthController } from './health.controller.js';

/** `/health/live` y `/health/ready` (T028). El logger propio de terminus se desactiva: el motivo se registra una vez. */
@Module({
  imports: [TerminusModule.forRoot({ logger: false }), DatabaseProbeModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator],
})
export class HealthModule {}
