import { Module } from '@nestjs/common';
import { IdempotencyRepository } from './idempotency.repository.js';
import { IdempotentInterceptor } from './idempotent.interceptor.js';

/** Idempotencia por tenant reutilizable (US6: T075, T076). Lo importa el módulo que declara `@Idempotent()`. */
@Module({
  providers: [IdempotencyRepository, IdempotentInterceptor],
  exports: [IdempotencyRepository, IdempotentInterceptor],
})
export class IdempotencyModule {}
