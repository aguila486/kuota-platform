import { Module } from '@nestjs/common';
import { AuditActorGuard } from './audit-actor.guard.js';
import { AuditService } from './audit.service.js';

/** Bitácora de auditoría append-only reutilizable (US6: T077). Lo importa el módulo que audita operaciones. */
@Module({
  providers: [AuditService, AuditActorGuard],
  exports: [AuditService, AuditActorGuard],
})
export class AuditModule {}
