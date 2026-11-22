# Motor de préstamos

> Estado del documento: **borrador para validación de negocio/finanzas**. Etiquetas:
> **[CONFIRMADO]** = dado por el negocio · **[PROPUESTO]** = recomendación de arquitectura ·
> **[PENDIENTE]** / **[PENDIENTE-LEGAL]** = requiere decisión (ver `decisions-register.md`).
> Los importes en MXN son **ilustrativos**; el país de operación no está confirmado (D-LEG-01).

## 1. Responsabilidad del motor

El motor de préstamos es un componente de **dominio puro** (Constitución VIII): recibe parámetros del producto,
datos del préstamo, un calendario de días inhábiles y un reloj inyectado, y devuelve calendarios de pago,
cálculos de intereses y moratorios. **No** persiste ni contabiliza: el módulo `loans` usa sus resultados y el
módulo `ledger` registra los asientos. El backend es la única autoridad; Flutter solo ejecuta simulaciones
(`financial_domain`) que deben producir resultados idénticos con los mismos casos de referencia.

## 2. Parámetros del producto financiero

| Parámetro | Valores | Estado |
|---|---|---|
| `interest_method` | `FLAT_GLOBAL`, `DECLINING_BALANCE` | [CONFIRMADO] |
| `interest_rate` | decimal, `NUMERIC(18,10)` | [CONFIRMADO] parámetro · [PROPUESTO] tipo |
| `interest_rate_basis` | `PER_PERIOD`, `MONTHLY`, `ANNUAL`, `TOTAL` | [CONFIRMADO] parámetro · [PENDIENTE] valores — D-FIN-03 |
| `payment_frequency` | `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY` | [CONFIRMADO] |
| `term_count` | entero > 0 (número de cuotas) | [CONFIRMADO] |
| `grace_days` | entero ≥ 0 (días tras vencimiento sin moratorio) | [CONFIRMADO] parámetro · [PENDIENTE] semántica exacta — D-FIN-06 |
| `late_fee_type` | `FIXED_PER_INSTALLMENT`, `DAILY_PERCENTAGE` | [CONFIRMADO] |
| `late_fee_value` | monto (unidades mínimas) o porcentaje decimal | [CONFIRMADO] |
| `allow_savings_collateral` | booleano | [CONFIRMADO] |
| `collateral_percentage` | decimal 0–1 | [CONFIRMADO] |
| `late_fee_cap` | monto/porcentaje máximo | [PROPUESTO] — D-FIN-06 |
| `rounding_mode`, `rounding_scale` | p. ej. `HALF_UP`, 2 | [PROPUESTO] — D-FIN-02 |

Los parámetros del producto se **versionan**: un préstamo guarda una copia inmutable (snapshot) de los parámetros
con los que se originó. Cambiar el producto no altera préstamos existentes. [PROPUESTO]

## 3. Tasas: por periodo, totales y anuales

**Regla [PROPUESTO, D-FIN-03]:** toda tasa se almacena con su base explícita y el motor la convierte a
**tasa por periodo** (`i_p`) antes de calcular. Nunca se infiere la base a partir del valor.

| Base | Significado | Conversión a tasa por periodo |
|---|---|---|
| `PER_PERIOD` | tasa aplicable a cada periodo de pago | `i_p = rate` |
| `TOTAL` | tasa sobre el principal por toda la vida del préstamo | solo válida con `FLAT_GLOBAL`; interés total = `P × rate` |
| `MONTHLY` | tasa mensual nominal | **[PENDIENTE]** proporcional (`rate × días_periodo / 30`) o por periodos/mes |
| `ANNUAL` | tasa anual nominal | **[PENDIENTE]** proporcional (`rate / periodos_por_año`) o efectiva |

### 3.1 Ejemplo de conversión (verificado con aritmética decimal)

Tasa anual nominal 48 %:

| Conversión | Resultado |
|---|---|
| Mensual nominal (÷ 12) | 4.000000 % |
| Quincenal (÷ 24) | 2.000000 % |
| Quincenal (÷ 26, catorcenal) | 1.846154 % |
| Semanal (÷ 52) | 0.923077 % |
| Diaria (÷ 360) | 0.133333 % |
| Diaria (÷ 365) | 0.131507 % |
| Mensual **efectiva** equivalente `(1.48)^(1/12) − 1` | 3.320970 % |

La diferencia entre conversión proporcional y efectiva es material (4.00 % vs 3.32 % mensual): por eso la
convención es una decisión de negocio y posiblemente regulatoria (divulgación de costo total, D-LEG-05),
**no** una elección técnica. También queda pendiente si `BIWEEKLY` significa 24 o 26 periodos por año.

## 4. Métodos de interés

### 4.1 `FLAT_GLOBAL` (interés global sobre principal original)

```
Interés total  I = P × i_total            (i_total = tasa TOTAL, o i_p × n)
Total a pagar  T = P + I
Cuota          C = T / n                  (redondeada según D-FIN-02)
Por cuota: capital = P / n, interés = I / n (redondeados; ajuste en la última cuota)
```

El interés **no** disminuye con los pagos de capital. Es común en microcrédito, pero su costo efectivo es mayor
que la tasa nominal aparente; la forma de divulgarlo es D-LEG-05 [PENDIENTE-LEGAL].

**Caso FLAT-01 (verificado)** — P = 10,000.00 · 12 cuotas semanales · 20 % TOTAL:

| Concepto | Valor |
|---|---|
| Interés total | 2,000.00 |
| Total a pagar | 12,000.00 |
| Cuota | **1,000.00** (exacta) |
| Cuotas 1–11 | capital 833.33 · interés 166.67 |
| Cuota 12 (ajuste) | capital 833.37 · interés 166.63 · total 1,000.00 |
| Suma capital | 833.33 × 11 + 833.37 = 10,000.00 |
| Suma interés | 166.67 × 11 + 166.63 = 2,000.00 |

### 4.2 `DECLINING_BALANCE` (saldo insoluto, sistema francés de cuota fija)

```
Cuota      A = P × i_p / (1 − (1 + i_p)^−n)
Interés_k  = round(Saldo_{k−1} × i_p)
Capital_k  = A − Interés_k
Saldo_k    = Saldo_{k−1} − Capital_k
Última cuota: Capital_n = Saldo_{n−1}; Cuota_n = Capital_n + Interés_n   (absorbe el redondeo)
```

**[PROPUESTO, D-FIN-04]** en v1 se usa la tasa **por periodo** sin conteo de días reales (cada periodo pesa igual).
La alternativa (interés por días reales, Actual/360 o Actual/365) queda pendiente.

**Caso DB-01 (verificado)** — P = 10,000.00 · 3 % por periodo · 6 periodos · redondeo HALF_UP a 0.01:

Cuota teórica `A = 1,845.975004…` → **1,845.98**

| # | Saldo inicial | Cuota | Interés | Capital | Saldo final |
|---|---:|---:|---:|---:|---:|
| 1 | 10,000.00 | 1,845.98 | 300.00 | 1,545.98 | 8,454.02 |
| 2 | 8,454.02 | 1,845.98 | 253.62 | 1,592.36 | 6,861.66 |
| 3 | 6,861.66 | 1,845.98 | 205.85 | 1,640.13 | 5,221.53 |
| 4 | 5,221.53 | 1,845.98 | 156.65 | 1,689.33 | 3,532.20 |
| 5 | 3,532.20 | 1,845.98 | 105.97 | 1,740.01 | 1,792.19 |
| 6 | 1,792.19 | **1,845.96** | 53.77 | 1,792.19 | 0.00 |
| **Σ** | | **11,075.86** | **1,075.86** | **10,000.00** | |

La última cuota es 0.02 menor por el ajuste de redondeo.

## 5. Frecuencias y calendario

| Frecuencia | Avance de fecha [PROPUESTO] | Periodos/año (para conversión) |
|---|---|---|
| `DAILY` | +1 día (¿solo hábiles? **[PENDIENTE]** D-FIN-05) | 360/365 **[PENDIENTE]** |
| `WEEKLY` | +7 días | 52 |
| `BIWEEKLY` | +14 días **o** días 15 y último del mes **[PENDIENTE]** | 26 o 24 |
| `MONTHLY` | mismo día del mes siguiente; si no existe, último día del mes | 12 |

- La primera fecha de pago se calcula desde la fecha de desembolso más un periodo, salvo que el producto defina
  una fecha de primer pago distinta [PROPUESTO].
- Las fechas se calculan en la **zona horaria del tenant** y se guardan como fechas (sin hora) [PROPUESTO].

### 5.1 Días inhábiles [PENDIENTE, D-FIN-05]

Recomendación: calendario de días inhábiles **por tenant** (fines de semana configurables + feriados).
Si un vencimiento cae en día inhábil, se mueve al **siguiente día hábil** sin interés adicional, y el conteo de
moratorio inicia desde la fecha ajustada. Alternativas: mantener la fecha (cobro en día inhábil, típico de
cobranza en campo) o mover al día hábil anterior. Para `DAILY`, decidir si se generan cuotas en días inhábiles.

## 6. Redondeo [PROPUESTO, D-FIN-02]

- Precisión interna: aritmética decimal con ≥ 28 dígitos significativos; sin flotantes (Constitución IV).
- Redondeo **HALF_UP a la unidad mínima de la moneda** en: interés de cada cuota, capital de cada cuota, cuota,
  moratorio de cada evento.
- Las diferencias acumuladas se absorben en la **última cuota** (casos FLAT-01 y DB-01).
- Alternativa: HALF_EVEN (redondeo bancario) — reduce sesgo en agregados; decisión de finanzas.
- Invariante: Σ capital de cuotas = principal exacto; Σ interés = interés total calculado.

## 7. Moratorios [PENDIENTE, D-FIN-06]

Se generan sobre cuotas **vencidas y no pagadas** una vez transcurridos `grace_days`.

| Tipo | Regla propuesta |
|---|---|
| `FIXED_PER_INSTALLMENT` | Un cargo fijo `late_fee_value` por cada cuota que supere la gracia. Se genera una sola vez por cuota. |
| `DAILY_PERCENTAGE` | `late_fee_value × base × días_de_atraso`, interés simple (sin capitalizar), desde el día siguiente al fin de la gracia. Base propuesta: monto vencido no pagado de la cuota (capital + interés). |

Pendientes: si los días de gracia se cuentan también al calcular (¿se cobra desde el vencimiento al terminar la
gracia, o solo después?), tope máximo (`late_fee_cap`), base (solo capital vs capital + interés), si un pago parcial
detiene/reduce la base, y el tratamiento fiscal (D-FIN-10, [PENDIENTE-LEGAL]).

**Caso MORA-01 (verificado)** — cuota vencida 1,000.00 · `DAILY_PERCENTAGE` 0.5 % diario · `grace_days` = 3 ·
pago 8 días después del vencimiento → días con moratorio = 8 − 3 = 5 → `1,000.00 × 0.005 × 5` = **25.00**.

**Caso MORA-02** — `FIXED_PER_INSTALLMENT` 50.00 · dos cuotas vencidas fuera de gracia → moratorio total **100.00**.

Los moratorios se **devengan** como evento contable (no se recalculan retroactivamente). Una condonación es un
asiento nuevo autorizado y auditado, nunca una edición.

## 8. Operaciones sobre préstamos vigentes

| Operación | Regla | Estado |
|---|---|---|
| Pago parcial | Se aplica por prelación (`payment-allocation.md`) | [PROPUESTO] D-FIN-07 |
| Anticipo / prepago | Reducir plazo vs reducir cuota; en FLAT, ¿bonificación de interés no devengado? | [PENDIENTE] D-FIN-08 |
| Liquidación anticipada | Saldo de capital + interés devengado (+ moratorios) | [PENDIENTE] D-FIN-08 — ver `settlement.md` |
| Reestructura | Nuevo préstamo que liquida el anterior con trazabilidad (`restructured_from_loan_id`) | [PROPUESTO] D-FIN-09 |
| Reverso de pago | Asiento de reverso + recálculo de estado de cuotas; nunca edición del pago | [CONFIRMADO] principio · Constitución V |
| Castigo / quebranto | No especificado | [PENDIENTE] (fuera de v1) |

## 9. Invariantes verificables del motor

1. Σ capital de cuotas = principal.
2. Para `FLAT_GLOBAL`: Σ interés = `P × i_total` (redondeado una vez).
3. Para `DECLINING_BALANCE`: saldo final = 0.00 y cada saldo ≥ 0.
4. Ninguna cuota negativa; la última cuota difiere de la regular a lo más en la tolerancia de redondeo (n × 0.005).
5. Determinismo: mismas entradas (incluido calendario y reloj) ⇒ mismo calendario, en backend y en Flutter.
6. Los casos FLAT-01, DB-01, MORA-01 y MORA-02 son pruebas *golden* obligatorias (ver `docs/quality/financial-invariants.md`).

## 10. Preguntas para validación financiera/regulatoria

- D-FIN-02 Modo de redondeo y punto de redondeo.
- D-FIN-03 Bases de tasa admitidas y semántica de `FLAT_GLOBAL` con base distinta a `TOTAL`.
- D-FIN-04 Convención de días para saldo insoluto.
- D-FIN-05 Días inhábiles.
- D-FIN-06 Moratorios: base, tope, gracia.
- D-FIN-08 / D-FIN-09 Prepagos y reestructuras.
- D-FIN-10 Impuestos sobre intereses y moratorios **[PENDIENTE-LEGAL]**.
- D-LEG-05 Topes de tasa y divulgación de costo total **[PENDIENTE-LEGAL]**.
