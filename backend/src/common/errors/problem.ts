/**
 * Errores RFC 9457 de Kuota (T021, FR-011). Códigos estables del contrato (`Problem.code`) con su estado HTTP y título.
 */
export const PROBLEM_CODES = {
  'validation-error': { status: 400, title: 'Solicitud inválida' },
  'tenant-context-required': { status: 401, title: 'Contexto de empresa requerido' },
  'not-found': { status: 404, title: 'No encontrado' },
  'version-conflict': { status: 409, title: 'Conflicto de versión' },
  'idempotency-request-in-progress': { status: 409, title: 'Solicitud en proceso' },
  'idempotency-key-reused': { status: 422, title: 'Clave de idempotencia reutilizada' },
  'app-version-unsupported': { status: 426, title: 'Versión de la app no soportada' },
  'internal-error': { status: 500, title: 'Error interno' },
} as const satisfies Record<string, { status: number; title: string }>;

export type ProblemCode = keyof typeof PROBLEM_CODES;

/** Base del URI `type` (docs/architecture/backend-architecture.md §8). */
export const PROBLEM_TYPE_BASE = 'https://errors.kuota.app/';

export interface ProblemFieldError {
  readonly field: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly correlation_id: string;
  readonly detail?: string;
  readonly errors?: readonly ProblemFieldError[];
}

export interface KuotaProblemOptions {
  /** Texto seguro para el cliente: sin datos internos, SQL ni PII. */
  readonly detail?: string;
  readonly errors?: readonly ProblemFieldError[];
  /** Encabezados adicionales de la respuesta (p. ej. `Retry-After`). */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Error tipado de las capas de aplicación y dominio; el filtro lo traduce a problem+json. */
export class KuotaProblemError extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly options: KuotaProblemOptions = {},
  ) {
    super(options.detail ?? PROBLEM_CODES[code].title);
    this.name = 'KuotaProblemError';
  }

  get status(): number {
    return PROBLEM_CODES[this.code].status;
  }
}
