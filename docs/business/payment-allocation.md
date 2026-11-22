# Prelación y aplicación de pagos

> Etiquetas: **[CONFIRMADO]** · **[PROPUESTO]** · **[PENDIENTE]** / **[PENDIENTE-LEGAL]**. Importes ilustrativos.

## 1. Regla base

**[CONFIRMADO] Prelación de conceptos:** `MORATORIOS → INTERÉS → CAPITAL`.

**[PROPUESTO, D-FIN-07] Orden entre cuotas:** se aplica **cuota por cuota, de la más antigua a la más reciente**
(aplicación "vertical"): una cuota debe quedar totalmente cubierta (moratorios, luego interés, luego capital) antes de
aplicar a la siguiente. La alternativa "horizontal" (primero todos los moratorios de todas las cuotas, luego todos los
intereses, luego capital) se documenta porque produce resultados distintos (ver §3.2) y debe ser elegida por negocio.

Solo se aplica a conceptos **exigibles** a la fecha valor del pago (cuotas vencidas y la cuota en curso), salvo que el
pago sea un anticipo explícito (§5).

## 2. Algoritmo propuesto

```text
entrada: pago (monto, fecha_valor, idempotency_key), préstamo con cuotas
restante = monto
para cada cuota exigible ordenada por fecha_vencimiento ascendente:
    para concepto en [MORATORIO, INTERÉS, CAPITAL]:
        aplicado = min(restante, pendiente(cuota, concepto))
        registrar aplicación (cuota, concepto, aplicado)
        restante -= aplicado
    si restante == 0: terminar
si restante > 0: tratar excedente (§4)
```

Cada pago genera **un asiento de partida doble** cuyas líneas reflejan exactamente la aplicación (ver
`financial-domain.md`). La aplicación se persiste como registro inmutable vinculado al asiento.

## 3. Ejemplos (verificados)

Préstamo del caso **FLAT-01** (`loan-engine.md`): cuota 1,000.00 = interés 166.67 + capital 833.33;
moratorio `FIXED_PER_INSTALLMENT` 50.00. Cuotas #1 y #2 vencidas fuera de gracia.

### 3.1 Pago parcial de una cuota — pago 600.00, solo cuota #1 vencida (con moratorio 50.00)

| Concepto | Pendiente | Aplicado | Pendiente después |
|---|---:|---:|---:|
| Moratorio #1 | 50.00 | 50.00 | 0.00 |
| Interés #1 | 166.67 | 166.67 | 0.00 |
| Capital #1 | 833.33 | 383.33 | 450.00 |
| **Total** | 1,050.00 | **600.00** | 450.00 |

La cuota #1 queda **parcialmente pagada**; el moratorio diario (si aplicara `DAILY_PERCENTAGE`) se seguiría calculando
sobre la base pendiente según D-FIN-06.

### 3.2 Dos cuotas vencidas — pago 1,000.00 (vertical vs horizontal)

Pendiente total: moratorios 100.00 + interés 333.34 + capital 1,666.66 = 2,100.00.

| Concepto | **Vertical [PROPUESTO]** | Horizontal (alternativa) |
|---|---:|---:|
| Moratorio #1 | 50.00 | 50.00 |
| Interés #1 | 166.67 | 166.67 |
| Capital #1 | 783.33 | 566.66 |
| Moratorio #2 | 0.00 | 50.00 |
| Interés #2 | 0.00 | 166.67 |
| Capital #2 | 0.00 | 0.00 |
| **Total** | **1,000.00** | **1,000.00** |

Con vertical, la cuota #2 permanece íntegra y sigue generando moratorio; con horizontal, se cubren antes los conceptos
que generan ingreso. El impacto en morosidad reportada y en ingresos es distinto: **decisión de negocio**.

### 3.3 Pago que cubre dos cuotas exactas — pago 2,100.00

Ambas cuotas quedan pagadas (moratorios 100.00 + intereses 333.34 + capital 1,666.66 = 2,100.00); restante 0.00.

## 4. Excedentes y sobrepagos [PENDIENTE, D-FIN-07 / D-SYNC-01]

Un excedente surge cuando el pago supera lo exigible. Alternativas:

| Alternativa | Efecto |
|---|---|
| A. Aplicar a cuotas futuras (adelanto de cuotas, en orden) | Cliente "adelantado"; no reduce interés en FLAT |
| B. Abonar a capital (prepago) | Ver §5 / D-FIN-08 |
| C. Saldo a favor del cliente (pasivo) | Aplicación posterior explícita |
| D. Rechazar | No viable en cobranza en efectivo: el dinero ya se recibió |

**Recomendación [PROPUESTO]:** pagos recibidos por cobradores **nunca se rechazan** por excedente (el efectivo es real);
el excedente se registra como **saldo a favor** (pasivo) y, si proviene de sincronización concurrente entre cobradores,
la operación queda en `REQUIRES_REVIEW` (D-SYNC-01). La aplicación del saldo a favor es una operación posterior auditada.

## 5. Anticipos y prepagos [PENDIENTE, D-FIN-08]

- **Adelanto de cuotas**: cubre cuotas futuras completas en su calendario original.
- **Abono a capital**: reduce saldo; requiere decidir si se **reduce el plazo** o **la cuota** (recalcular calendario en
  `DECLINING_BALANCE`). En `FLAT_GLOBAL`, decidir si se bonifica interés no devengado.
- Recomendación: en v1 permitir solo adelanto de cuotas y liquidación total; el abono a capital con recálculo queda
  para una versión posterior tras decisión.

## 6. Reversos

Un pago confirmado no se edita: se genera un **asiento de reverso** que deshace exactamente las líneas de la aplicación
original, y el estado de las cuotas se recalcula a partir del ledger. Si después de un reverso existían pagos
posteriores, **no** se reaplican automáticamente en v1 [PROPUESTO]: se marcan para revisión, porque reaplicar puede cambiar
moratorios ya devengados. Política final: D-FIN-07.

## 7. Invariantes

1. Σ aplicaciones de un pago = monto del pago (incluido excedente registrado).
2. Ningún concepto queda con pendiente negativo.
3. El asiento del pago está balanceado (débitos = créditos).
4. Repetir el pago con la misma `idempotency_key` no genera una segunda aplicación (Constitución VI).
