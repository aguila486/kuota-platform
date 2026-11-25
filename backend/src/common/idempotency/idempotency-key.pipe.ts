import { Injectable, type PipeTransform } from '@nestjs/common';
import { KuotaProblemError } from '../errors/problem.js';

/** data-model.md `idempotency_keys.key`: 8–128 caracteres `[A-Za-z0-9_-]` (contrato `IdempotencyKey`). */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * Valida presencia y formato de `Idempotency-Key` (T042). Ausente, repetida o con formato inválido → 400
 * `validation-error`, sin reflejar el valor recibido.
 *
 * SOLO valida: no almacena la clave ni reproduce respuestas. La deduplicación (`idempotency_keys`, respuesta
 * reproducida, 409 `idempotency-request-in-progress` y 422 `idempotency-key-reused`) es T076 (US6), que reutiliza este
 * pipe desde `IdempotentInterceptor` (`@Idempotent()`).
 */
@Injectable()
export class IdempotencyKeyPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) {
      throw new KuotaProblemError('validation-error', {
        errors: [{ field: 'Idempotency-Key', message: 'Obligatoria: 8–128 caracteres [A-Za-z0-9_-]' }],
      });
    }
    return value;
  }
}
