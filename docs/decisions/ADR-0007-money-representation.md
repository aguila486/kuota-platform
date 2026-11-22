# ADR-0007: Representación monetaria exacta (D-FIN-01)

- **Estado:** Aceptado (2026-11-22, responsable del proyecto): decisión D-FIN-01
- **Fecha:** 2026-11-22
- **Decisores:** Responsable del proyecto (Tecnología/Finanzas)
- **Relacionado:** Constitución IV; D-FIN-01 (aprobada), D-FIN-02 (redondeo de negocio, pendiente), D-FIN-03 (base de
  tasas, pendiente); ADR-0004, ADR-0005; `specs/001-platform-foundation` (US4, FR-019..FR-022, T056–T065)

## Contexto

Kuota calcula y registra dinero en el backend (TypeScript), en PostgreSQL y en las apps (Dart, incluido Flutter Web).
El punto flotante binario está prohibido (Constitución IV). En Flutter Web, `int` es un número de JavaScript y pierde
precisión por encima de 2^53. Esta decisión fija **cómo se representa** el dinero. No fija reglas comerciales: el
redondeo de cuotas (D-FIN-02), la base de tasas (D-FIN-03) y la amortización se deciden en 004–007.

## Opciones consideradas

1. **Entero en unidades mínimas (`BIGINT`) + moneda ISO 4217.** Exacto, simple de sumar y de comparar.
2. `NUMERIC(p,s)` para montos. Exacto, pero la escala viaja con el tipo y se mezcla con la de la moneda.
3. Decimal en texto en todas las capas. Exacto, pero obliga a usar una librería decimal en cada operación trivial.

## Decisión

**Opción 1**, con tasas en `NUMERIC(18,10)`.

### Representación por capa

| Capa | Monto | Moneda | Tasas y factores |
|---|---|---|---|
| PostgreSQL | `BIGINT` (unidades mínimas) | `CHAR(3)` | `NUMERIC(18,10)` |
| TypeScript | `bigint` (`Money.amountMinor`) | `CurrencyCode` del catálogo | `Decimal` (decimal.js en instancia clonada, `precision: 40`) |
| Dart (móvil y web) | `BigInt` (nunca `int`, `double` ni `num`) | `CurrencyCode` del catálogo | `Decimal` (paquete `decimal`) |
| JSON | `{"amount_minor": "<string>", "currency": "XXX"}` | ISO 4217 en mayúsculas | string decimal (cuando se exponga; base pendiente D-FIN-03) |

### Escalas y catálogo de monedas

- La escala de cada moneda es su número de unidades menores según ISO 4217 (p. ej. 0 para JPY, 2 para MXN o USD, 3
  para BHD, 4 para CLF). La escala **nunca** viaja en el payload; se obtiene del catálogo.
- El catálogo es cerrado y está en código en ambos lados. Una copia de referencia
  (`contracts/fixtures/money/currencies.json`) hace que las pruebas de backend y Dart fallen si los catálogos divergen.
- Moneda fuera del catálogo → error `UNSUPPORTED_CURRENCY`. Qué monedas habilita cada empresa es una decisión de
  negocio pendiente (depende del país, D-LEG-01).

### Límites de representación

- Rango válido de `amountMinor`: −9 223 372 036 854 775 807 … 9 223 372 036 854 775 807 (rango de `BIGINT`, sin
  usar el mínimo absoluto). Es un invariante de `Money` en TypeScript y Dart: toda operación cuyo resultado salga del
  rango falla con `AMOUNT_OUT_OF_RANGE`. Nunca se trunca ni se satura.
- Los montos pueden ser negativos (diferencias, saldos). Cada operación de dominio valida el signo que admite; por
  ejemplo, las líneas del ledger son siempre > 0 con dirección (ADR-0005).

### Serialización JSON sin pérdida

- `amount_minor` es **siempre string** y en forma canónica: `0`, o un signo `-` opcional seguido de 1 a 19 dígitos sin
  ceros a la izquierda (patrón `^(0|-?[1-9][0-9]{0,18})$`); además debe estar dentro del rango anterior. `-0`, `007`,
  exponentes, espacios, separadores y decimales se rechazan con `INVALID_AMOUNT` (400 `validation-error`).
- La forma canónica garantiza que el mismo monto produzca el mismo JSON, lo que importa para el hash de idempotencia.
- Prohibido `type: number` para montos o tasas en el contrato.

### Conversión entre unidades mínimas y presentación

- `parse(text, currency)`: acepta una cadena decimal sin separadores de miles (`1234.5`, `-0.75`); más decimales que la
  escala → `TOO_MANY_DECIMALS` (nunca se redondea en silencio); formato inválido → `INVALID_AMOUNT`.
- `format(money)`: produce la cadena decimal canónica con exactamente `escala` decimales y punto (`1234.50`, `-0.75`,
  `100` para JPY). El formato localizado (símbolo, separadores, idioma) lo hace solo la UI (`design_system`) y nunca
  vuelve a un cálculo.

### Aritmética y redondeo

- `add`/`subtract` solo entre la misma moneda (`CURRENCY_MISMATCH`). `multiply(factor: Decimal, rounding)` exige un modo
  de redondeo explícito (`HALF_UP`, `HALF_EVEN`, `DOWN`, `UP`, `FLOOR`, `CEILING`); **no hay modo por defecto**. Si el
  resultado es inexacto y no se da modo → `ROUNDING_REQUIRED`.
- `allocate(n | ratios)`: reparto exacto (la suma de las partes es igual al total) por mayor residuo; los empates se
  resuelven por orden de índice, de forma determinista en ambos lados.
- Qué modo usa cada operación de negocio (cuotas, intereses, moratorios) es **D-FIN-02, pendiente**. Esta decisión no
  lo fija.

## Consecuencias

- **Positivas:** exactitud en todas las capas; comparación y suma triviales; sin pérdida en web ni en JSON.
- **Negativas:** conversión obligatoria en presentación; `BigInt` en Dart es más verboso que `int`.
- **Riesgos:** catálogos divergentes (mitigado con la copia de referencia en pruebas); uso accidental de `int` en Dart
  (mitigado con la regla de R-10 y revisión).

## Validación

Fixtures compartidos (`contracts/fixtures/money/*.json`, T056) ejecutados en backend (T057) y en Dart sobre la VM y
sobre web (T059). Incluyen: límites del rango y desbordamiento, valores > 2^53, forma canónica, monedas de escala 0, 2,
3 y 4, moneda no soportada, cada modo de redondeo con .5 positivo y negativo, y `allocate` con residuos. Pruebas de
propiedades (T058). Regla anti punto flotante (T064, T065).

## Revisión

Reevaluar si se requieren monedas con más de 4 decimales, criptoactivos o montos fuera del rango de `BIGINT`.
