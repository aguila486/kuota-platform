import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { expect } from 'vitest';

/**
 * `expectToMatchContract(res, operationId)` (T066; research R-14; US5-2): valida una respuesta REAL del backend contra
 * el contrato OpenAPI 3.1 con Ajv 2020 (JSON Schema 2020-12), sobre el bundle de Redocly generado en el momento desde
 * `contracts/openapi` (fuente de verdad; ninguna definición paralela).
 *
 * Comprueba, en este orden:
 * 1. que la operación existe y declara el código HTTP recibido (sin `default`: un código no declarado falla);
 * 2. que el Content-Type pertenece a los medios declarados (sin parámetros), o que no hay cuerpo si la respuesta no
 *    declara contenido (p. ej. 204);
 * 3. que están los encabezados marcados `required` y que los encabezados declarados presentes cumplen su esquema;
 * 4. que el cuerpo JSON cumple el esquema, incluidos `additionalProperties: false`, `required`, enumeraciones y
 *    formatos.
 *
 * Formatos: el contrato usa `uuid`, `date-time` y `uri-reference`. Se registran aquí, sin dependencias nuevas. Si el
 * contrato introduce otro formato, la carga falla (no se ignora en silencio).
 *
 * Respuesta: `{ status, headers, body }`, donde `body` es el texto crudo; `fromFetch` la construye desde `fetch`.
 */

export interface ContractResponse {
  readonly status: number;
  readonly headers: Headers;
  /** Cuerpo crudo de la respuesta (cadena vacía si no hay). */
  readonly body: string;
}

export async function fromFetch(res: Response): Promise<ContractResponse> {
  return { status: res.status, headers: res.headers, body: await res.text() };
}

type Json = Record<string, unknown>;
interface ResponseSpec {
  content?: Record<string, { schema?: unknown }>;
  headers?: Record<string, { required?: boolean; schema?: unknown }>;
}

const BUNDLE_ID = 'https://contracts.kuota.app/kuota-core.v1.json';
const SUPPORTED_FORMATS = ['uuid', 'date-time', 'uri-reference'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// RFC 3339 date-time con zona obligatoria (Z u offset).
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('No se encontró la raíz del repositorio');
    dir = parent;
  }
  return dir;
}

/** Bundle JSON del contrato, generado con Redocly desde la fuente versionada (una vez por proceso). */
function bundleContract(): Json {
  const root = findRepoRoot(process.cwd());
  const dir = mkdtempSync(join(tmpdir(), 'kuota-contract-'));
  const out = join(dir, 'kuota-core.v1.json');
  try {
    execFileSync(
      join(root, 'node_modules/.bin/redocly'),
      [
        'bundle',
        'contracts/openapi/kuota-core.v1.yaml',
        '--config',
        'contracts/openapi/redocly.yaml',
        '--ext',
        'json',
        '-o',
        out,
      ],
      { cwd: root, stdio: 'pipe' },
    );
    return JSON.parse(readFileSync(out, 'utf8')) as Json;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function collectFormats(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => collectFormats(n, found));
  else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'format' && typeof value === 'string') found.add(value);
      else collectFormats(value, found);
    }
  }
  return found;
}

const escapePointer = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

class Contract {
  private readonly ajv: Ajv2020;
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(readonly document: Json) {
    const unsupported = [...collectFormats(document)].filter(
      (f) => !(SUPPORTED_FORMATS as readonly string[]).includes(f),
    );
    if (unsupported.length > 0) throw new Error(`Formato sin validador en el matcher: ${unsupported.join(', ')}`);
    // strict desactivado SOLO porque el documento OpenAPI contiene palabras clave que no son JSON Schema (openapi,
    // paths, x-kuota-*…). Los formatos sí se validan y un formato desconocido falla arriba.
    this.ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
    this.ajv.addFormat('uuid', UUID);
    this.ajv.addFormat('date-time', { validate: (v: string) => DATE_TIME.test(v) && !Number.isNaN(Date.parse(v)) });
    this.ajv.addFormat('uri-reference', { validate: (v: string) => !/\s/.test(v) });
    this.ajv.addSchema({ ...document, $id: BUNDLE_ID });
  }

  operation(operationId: string): { path: string; method: string; op: Json } {
    for (const [path, item] of Object.entries(this.document['paths'] as Record<string, Json>)) {
      for (const [method, op] of Object.entries(item)) {
        if (op !== null && typeof op === 'object' && (op as Json)['operationId'] === operationId) {
          return { path, method, op: op as Json };
        }
      }
    }
    throw new Error(`operationId desconocido en el contrato: ${operationId}`);
  }

  /** Respuesta declarada para un código (sin `default`), con su puntero JSON para Ajv. */
  response(
    operationId: string,
    status: number,
  ): { spec: ResponseSpec; pointer: string; headerPointers: Record<string, string> } | undefined {
    const { path, method, op } = this.operation(operationId);
    const responses = op['responses'] as Record<string, Json>;
    let response = responses[String(status)];
    let pointer = `#/paths/${escapePointer(path)}/${method}/responses/${status}`;
    if (!response) return undefined;
    const ref = response['$ref'];
    if (typeof ref === 'string') {
      pointer = ref;
      response = this.resolve(ref) as Json;
    }
    // Los encabezados también pueden ser `$ref` (components/headers): se resuelven con su propio puntero.
    const headers: NonNullable<ResponseSpec['headers']> = {};
    const headerPointers: Record<string, string> = {};
    for (const [name, header] of Object.entries((response['headers'] ?? {}) as Record<string, Json>)) {
      const headerRef = header['$ref'];
      headers[name] = (typeof headerRef === 'string' ? this.resolve(headerRef) : header) as { required?: boolean };
      headerPointers[name] = typeof headerRef === 'string' ? headerRef : `${pointer}/headers/${escapePointer(name)}`;
    }
    return { spec: { ...(response as ResponseSpec), headers }, pointer, headerPointers };
  }

  private resolve(ref: string): unknown {
    return ref
      .slice(2)
      .split('/')
      .reduce<unknown>((node, seg) => (node as Json)[seg.replace(/~1/g, '/').replace(/~0/g, '~')], this.document);
  }

  validator(pointer: string): ValidateFunction {
    let validate = this.validators.get(pointer);
    if (!validate) {
      validate = this.ajv.compile({ $ref: `${BUNDLE_ID}${pointer}` });
      this.validators.set(pointer, validate);
    }
    return validate;
  }

  errorsText(validate: ValidateFunction): string {
    return this.ajv.errorsText(validate.errors, { separator: '; ' });
  }
}

let contract: Contract | undefined;
export function loadContract(): Contract {
  contract ??= new Contract(bundleContract());
  return contract;
}

/** Lista de discrepancias (vacía si la respuesta cumple el contrato). Útil para las pruebas negativas del matcher. */
export function contractViolations(res: ContractResponse, operationId: string): string[] {
  const c = loadContract();
  const found = c.response(operationId, res.status);
  if (!found) return [`${operationId}: el código ${res.status} no está declarado en el contrato`];
  const { spec, pointer, headerPointers } = found;
  const violations: string[] = [];

  for (const [name, header] of Object.entries(spec.headers ?? {})) {
    const value = res.headers.get(name);
    if (value === null) {
      if (header.required) violations.push(`${operationId} ${res.status}: falta el encabezado requerido ${name}`);
      continue;
    }
    if (header.schema !== undefined) {
      const schema = header.schema as Json;
      const parsed = schema['type'] === 'integer' && /^-?\d+$/.test(value) ? Number(value) : value;
      const validate = c.validator(`${headerPointers[name]}/schema`);
      if (!validate(parsed)) {
        violations.push(`${operationId} ${res.status}: encabezado ${name} inválido (${c.errorsText(validate)})`);
      }
    }
  }

  const media = Object.keys(spec.content ?? {});
  if (media.length === 0) {
    if (res.body !== '')
      violations.push(`${operationId} ${res.status}: el contrato no declara cuerpo y se recibió uno`);
    return violations;
  }
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!media.includes(contentType)) {
    violations.push(`${operationId} ${res.status}: Content-Type '${contentType}' no declarado (${media.join(', ')})`);
    return violations;
  }
  let body: unknown;
  try {
    body = JSON.parse(res.body);
  } catch {
    return [...violations, `${operationId} ${res.status}: el cuerpo no es JSON`];
  }
  const validate = c.validator(`${pointer}/content/${escapePointer(contentType)}/schema`);
  if (!validate(body))
    violations.push(`${operationId} ${res.status}: cuerpo fuera de contrato (${c.errorsText(validate)})`);
  return violations;
}

/** Aserción para las pruebas de contrato (T067, T095). */
export function expectToMatchContract(res: ContractResponse, operationId: string): void {
  expect(contractViolations(res, operationId), `${operationId} ${res.status}: ${res.body.slice(0, 300)}`).toEqual([]);
}
