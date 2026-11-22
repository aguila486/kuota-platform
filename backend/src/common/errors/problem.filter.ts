import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { CORRELATION_HEADER, correlationIdFor } from '../logging/correlation.js';
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

/**
 * Estados de HttpException → código del contrato. Los mensajes de HttpException NO se exponen (pueden contener datos
 * internos); solo los mensajes de validación se devuelven en `errors[]`. Un 4xx sin código propio en el contrato conserva
 * su estado y usa `validation-error` (pendiente de que el contrato defina códigos para 403/405 en 002).
 */
function fromHttpException(exception: HttpException): MappedProblem {
  const status = exception.getStatus();
  if (status >= 500) return { code: 'internal-error', status: 500 };
  if (status === 401) return { code: 'tenant-context-required', status };
  if (status === 404) return { code: 'not-found', status };
  if (status === 426) return { code: 'app-version-unsupported', status };
  const response = exception.getResponse();
  const messages =
    typeof response === 'object' && response !== null && Array.isArray((response as { message?: unknown }).message)
      ? (response as { message: unknown[] }).message.filter((m): m is string => typeof m === 'string')
      : [];
  return messages.length > 0
    ? { code: 'validation-error', status, errors: messages.map((message) => ({ field: 'request', message })) }
    : { code: 'validation-error', status };
}

function toProblem(exception: unknown): MappedProblem {
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
      this.logger.error({ err, code: problem.code, correlation_id: correlationId }, 'Error no controlado');
    } else {
      this.logger.debug(
        { code: problem.code, status: problem.status, correlation_id: correlationId },
        'Error de cliente',
      );
    }

    if (res.headersSent) return;
    res.statusCode = problem.status;
    res.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
    res.setHeader(CORRELATION_HEADER, correlationId);
    for (const [name, value] of Object.entries(problem.headers ?? {})) res.setHeader(name, value);
    res.end(JSON.stringify(body));
  }
}
