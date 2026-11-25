import { Global, Module } from '@nestjs/common';
import { DevTenantGuard } from './dev-tenant.guard.js';
import { TenantContext } from './tenant-context.js';
import { TenantPrismaService } from './tenant-prisma.service.js';

/** Contexto de tenant y acceso a datos por tenant (T038, T039). */
@Global()
@Module({
  providers: [TenantContext, TenantPrismaService, DevTenantGuard],
  exports: [TenantContext, TenantPrismaService, DevTenantGuard],
})
export class TenantContextModule {}
