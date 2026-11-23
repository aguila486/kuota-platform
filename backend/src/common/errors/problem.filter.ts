import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger, Optional } from '@nestjs/common';
import { CORRELATION_HEADER, correlationIdFor } from '../logging/correlation.js';
import { MetricsRuntime } from '../metrics/metrics.module.js';
import {
  KuotaProblemError,
  PROBLEM_CODES,
  PROBLEM_TYPE_BASE,
  type ProblemCode,
  type ProblemDetails,
  type ProblemFieldError,
} from './problem.js';

interface MappedProblem {
  readonly code: ProblemCode;
  readonly status: number;
  readonly detail?: string;
  readonly errors?: readonly ProblemFieldError[];
  readonly headers?: Readonly<Record<string, string>>;
}

/** Estados de HttpException que el contrato sí cubre: errores de entrada (validation-error) y recurso inexistente. */
const INPUT_ERROR_STATUSES = new Set([400, 413, 415, 422]);

/**
 * HttpException → código del contrato. Solo se traducen los estados que el contrato cubre para errores genéricos del
 * framework (404 y errores de entrada). Los demás (401, 403, 405, 426, 5xx…) no tienen código genérico aprobado: en 001
 * esos estados solo los produce `KuotaProblemError`, así que una HttpException con ellos es un error de programación y
 * se responde 500 `internal-error` (pendiente: códigos para 403/405 en el contrato de 002). Los mensajes de HttpException
 * nunca se exponen; solo los de validación, en `errors[]`.
 */
function fromHttpException(exception: HttpException): MappedProblem & { unmapped?: true } {
  const status = exception.getStatus();
  if (status === 404) return { code: 'not-found', status };
  if (!INPUT_ERROR_STATUSES.has(status)) return { code: 'internal-error', status: 500, unmapped: true };
  const response = exception.getResponse();
  const messages =
    typeof response === 'object' && response !== null && Array.isArray((response as { message?: unknown }).message)
      ? (response as { message: unknown[] }).message.filter((m): m is string => typeof m === 'string')
      : [];
  return messages.length > 0
    ? { code: 'validation-error', status, errors: messages.map((message) => ({ field: 'request', message })) }
    : { code: 'validation-error', status };
}

function toProblem(exception: unknown): MappedProblem & { unmapped?: true } {
  if (exception instanceof KuotaProblemError) {
    return {
      code: exception.code,
      status: exception.status,
      ...(exception.options.detail !== undefined && { detail: exception.options.detail }),
      ...(exception.options.errors !== undefined && { errors: exception.options.errors }),
      ...(exception.options.headers !== undefined && { headers: exception.options.headers }),
    };
  }
  if (exception instanceof HttpException) return fromHttpException(exception);
  return { code: 'internal-error', status: 500 };
}

/** Filtro global (T021): toda excepción → `application/problem+json` con `code` y `correlation_id` (FR-011). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  /** Métricas (T094): el contador de errores por código estable se alimenta aquí. Opcional en pruebas aisladas. */
  constructor(@Optional() private readonly metrics?: MetricsRuntime) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<IncomingMessage>();
    const res = http.getResponse<ServerResponse>();
    const problem = toProblem(exception);
    const correlationId = correlationIdFor(req);

    const body: ProblemDetails = {
      type: `${PROBLEM_TYPE_BASE}${problem.code}`,
      title: PROBLEM_CODES[problem.code].title,
      status: problem.status,
      code: problem.code,
      correlation_id: correlationId,
      ...(problem.detail !== undefined && { detail: problem.detail }),
      ...(problem.errors !== undefined && { errors: problem.errors }),
    };

    if (problem.status >= 500) {
      // El detalle (con stack, redactado por el logging) va solo al log, nunca al cliente.
      const err = exception instanceof Error ? exception : new Error('Valor no Error lanzado');
      const message = problem.unmapped
        ? `HttpException ${(exception as HttpException).getStatus()} sin código en el contrato: usar KuotaProblemError`
        : 'Error no controlado';
      this.logger.error({ err, code: problem.code, correlation_id: correlationId }, message);
    } else {
      this.logger.debug(
        { code: problem.code, status: problem.status, correlation_id: correlationId },
        'Error de cliente',
      );
    }

    if (res.headersSent) return;
    this.metrics?.metrics.recordError(problem.code);
    res.statusCode = problem.status;
    res.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
    res.setHeader(CORRELATION_HEADER, correlationId);
    for (const [name, value] of Object.entries(problem.headers ?? {})) res.setHeader(name, value);
    res.end(JSON.stringify(body));
  }
}
