import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  RequestMethod,
  UseInterceptors,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { lastValueFrom, type Observable, of } from 'rxjs';
import { IDEMPOTENCY_HEADER, IdempotencyKeyPipe } from './idempotency-key.pipe.js';
import { IdempotencyRepository } from './idempotency.repository.js';
import { requestHash } from './request-hash.js';

/** Clave CLS con la `Idempotency-Key` de la operación en curso (la lee `AuditService` para `audit_events.idempotency_key`). */
export const CLS_IDEMPOTENCY_KEY = 'idempotencyKey';
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

type JsonRequest = IncomingMessage & { readonly body?: unknown; readonly originalUrl?: string };

/**
 * Interceptor de `@Idempotent()` (T076; FR-023). Reutiliza `IdempotencyKeyPipe` (T042) para validar la clave, calcula
 * `request_hash` y ejecuta el handler DENTRO de la transacción del repositorio de idempotencia: la fila de la clave,
 * el efecto del comando y su auditoría se confirman o revierten juntos.
 *
 * Respuestas: reproducción con `Idempotent-Replayed: true`, 409 `idempotency-request-in-progress` con `Retry-After`,
 * 422 `idempotency-key-reused` y 400 `validation-error` si la clave falta o es inválida. Requiere que el contexto de
 * tenant ya esté fijado por el guard.
 */
@Injectable()
export class IdempotentInterceptor implements NestInterceptor {
  private readonly keyPipe = new IdempotencyKeyPipe();

  constructor(
    private readonly repository: IdempotencyRepository,
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<JsonRequest>();
    const response = http.getResponse<ServerResponse>();
    const key = this.keyPipe.transform(request.headers[IDEMPOTENCY_HEADER]);
    const method = (request.method ?? 'GET').toUpperCase();
    const path = new URL(request.originalUrl ?? request.url ?? '/', 'http://localhost').pathname;
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (method === RequestMethod[RequestMethod.POST] ? HttpStatus.CREATED : HttpStatus.OK);

    const outcome = await this.repository.run(
      { key, requestHash: requestHash(method, path, request.body), method, path },
      async () => {
        this.cls.set(CLS_IDEMPOTENCY_KEY, key);
        // `handle()` se invoca aquí, dentro de la transacción: Nest crea el ámbito asíncrono del handler en ese momento,
        // así que el caso de uso reutiliza esta misma transacción (withTenant anidado, ADR-0002 C2-1).
        return { status, body: await lastValueFrom(next.handle(), { defaultValue: null }) };
      },
    );
    if (outcome.replayed) response.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return of(outcome.body);
  }
}

/** Declara idempotente una operación de escritura (T076). La operación DEBE estar protegida por un guard de contexto. */
export const Idempotent = (): MethodDecorator => UseInterceptors(IdempotentInterceptor);
