// Reglas propias del contrato de Kuota Core (T023; research R-13). Plugin de Redocly: las "configurable rules" no
// pueden exigir un parámetro concreto en función de una extensión de la operación.

const IDEMPOTENCY_HEADER = 'idempotency-key';
const WRITE_METHODS = new Set(['post', 'put', 'patch']);
// Propiedades que representan dinero; `amount_minor` es el campo interno de Money (string).
const MONEY_PROPERTY = /(^|_)(amount|balance|price|fee|money)(_|$)/i;
const isMoneyRef = (node) => typeof node?.$ref === 'string' && /(^|\/)Money(\.yaml)?$/.test(node.$ref);

/** Operaciones idempotentes (`x-kuota-idempotent`) o financieras de escritura (`x-kuota-financial`) exigen Idempotency-Key. */
function idempotencyKeyRequired() {
  return {
    Operation(operation, { report, location, resolve, key }) {
      const marked =
        operation['x-kuota-idempotent'] === true ||
        (operation['x-kuota-financial'] === true && WRITE_METHODS.has(String(key).toLowerCase()));
      if (!marked) return;
      const header = (operation.parameters ?? [])
        .map((param) => resolve(param).node)
        .find((param) => param?.in === 'header' && String(param.name).toLowerCase() === IDEMPOTENCY_HEADER);
      if (!header || header.required !== true) {
        report({
          message: 'Una operación idempotente o financiera debe declarar el encabezado Idempotency-Key requerido.',
          location: location.key(),
        });
      }
    },
  };
}

/**
 * Toda respuesta 4xx/5xx usa solo `application/problem+json` (RFC 9457). Excepción justificada: las operaciones con
 * etiqueta `health`, cuya respuesta 503 es el estado de disponibilidad (ReadinessStatus), no un error del cliente.
 */
function problemJsonErrors() {
  return {
    Operation(operation, { report, location, resolve }) {
      if ((operation.tags ?? []).includes('health')) return;
      for (const [status, raw] of Object.entries(operation.responses ?? {})) {
        if (!/^[45]/.test(status)) continue;
        const types = Object.keys(resolve(raw).node?.content ?? {});
        if (types.length !== 1 || types[0] !== 'application/problem+json') {
          report({
            message: `La respuesta ${status} debe usar únicamente application/problem+json.`,
            location: location.child(['responses', status]).key(),
          });
        }
      }
    },
  };
}

/** Las propiedades monetarias referencian el esquema Money (nunca number/integer ni objetos ad hoc). */
function moneyViaRef() {
  return {
    Schema(schema, { report, location }) {
      for (const [name, prop] of Object.entries(schema.properties ?? {})) {
        if (!MONEY_PROPERTY.test(name) || name === 'amount_minor') continue;
        const variants = prop?.oneOf ?? prop?.anyOf;
        const ok = isMoneyRef(prop) || (Array.isArray(variants) && variants.every((v) => isMoneyRef(v) || v?.type === 'null'));
        if (!ok) {
          report({
            message: `La propiedad monetaria "${name}" debe ser $ref a Money (o oneOf Money | null).`,
            location: location.child(['properties', name]).key(),
          });
        }
      }
    },
  };
}

export default function kuotaRules() {
  return {
    id: 'kuota',
    rules: {
      oas3: {
        'idempotency-key-required': idempotencyKeyRequired,
        'problem-json-errors': problemJsonErrors,
        'money-via-ref': moneyViaRef,
      },
    },
  };
}
