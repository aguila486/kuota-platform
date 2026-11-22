# Matriz regulatoria, comercial y técnica

> Estado: **Borrador para validación especializada** · 2026-11-22
>
> **Advertencia.** Este documento **no es asesoría legal** y **no afirma** que alguna ley sea aplicable. El país inicial de
> operación **no está confirmado** (D-LEG-01): el uso de MXN en ejemplos **no** lo confirma. Las menciones a México son
> únicamente ejemplos de lo que habría que validar *si* ese fuera el país, y deben revisarse con un especialista.
> Ningún requisito de la columna "legal" puede implementarse como cumplido hasta su validación (principio XV).

## 1. Clasificación

- **Requisito técnico (T)**: control que Kuota implementa independientemente del país (lo exige la Constitución).
- **Decisión comercial (C)**: elección de negocio de Kuota o de cada tenant.
- **Requisito legal pendiente (L)**: depende del país, la figura jurídica del tenant y el producto; **PENDIENTE-LEGAL**.

## 2. Matriz

| Tema | Requisitos técnicos (T) | Decisiones comerciales (C) | Requisitos legales pendientes de validación (L) | IDs |
|---|---|---|---|---|
| **Figura jurídica de los tenants** | Configuración de productos habilitados por tenant; posibilidad de deshabilitar ahorro por tenant | Segmento objetivo (financieras formales, cajas, prestamistas informales) | Qué figuras pueden otorgar crédito y cuáles pueden recibir recursos del público; registros/autorizaciones requeridos. P. ej., si el país es México, habría que validar figuras como SOFOM, SOCAP, SOFIPO y sus supervisores | D-LEG-06, D-LEG-01 |
| **Ahorro programado** ⚠️ | Ledger con ahorro como **pasivo** del tenant; segregación contable; producto desactivable; bloqueo de salida a producción de 008 | Diseño del producto (bloqueo, rendimiento, liquidación) | **Crítico**: recibir dinero del público con promesa de devolución y rendimiento puede constituir **captación de recursos del público**, actividad típicamente reservada a entidades autorizadas y con un régimen distinto al de préstamos. Validar si el producto es legalmente posible para cada tipo de tenant, o si debe reestructurarse (p. ej. como garantía líquida vinculada a crédito) | D-SAV-04, D-LEG-06 |
| **Préstamos respaldados por ahorro** | Bloqueo/reserva contable de garantía, liberación trazable | % máximo de garantía, préstamos simultáneos | Validez de la compensación del ahorro contra deuda incumplida, consentimiento contractual requerido | D-COL-01, D-COL-02 |
| **Tasas, costos y divulgación** | Tasa con base explícita; cálculo y presentación del costo total; simulador con leyenda de "proyección" | Política de precios por tenant | Topes de tasa o usura, obligación de mostrar un indicador de costo total (p. ej., si México: CAT), contenido mínimo de contratos y estados de cuenta | D-LEG-05, D-FIN-03 |
| **Moratorios** | Configurables con tope; cálculo auditable | Montos y gracia por producto | Límites legales a penalizaciones e intereses moratorios | D-FIN-06, D-LEG-05 |
| **Impuestos sobre intereses/comisiones** | Soporte de impuestos como componente separado en ledger (desactivado hasta validar) | — | Si los intereses/comisiones causan impuestos (p. ej. IVA) y cómo se desglosan | D-FIN-10 |
| **KYC / prevención de lavado de dinero** | Expediente del cliente por tenant, documentos cifrados, umbrales y alertas configurables, reportes exportables | Nivel de expediente por producto | Obligaciones de identificación, conservación, reportes de operaciones (relevantes, inusuales, efectivo) y su autoridad receptora | D-LEG-03 |
| **Protección de datos personales** | Controles de `privacy.md` (minimización, cifrado, enmascaramiento, derechos) | Contrato tenant–Kuota | Ley aplicable, avisos de privacidad, consentimiento, plazos de derechos, transferencias, rol responsable/encargado | D-LEG-02, D-BIZ-02 |
| **Comprobantes y recibos** | Recibo operativo digital con folio y QR verificable, provisional vs confirmado | Diseño del recibo, marca del tenant | Si los recibos tienen validez fiscal o si se requiere un comprobante fiscal adicional; datos mínimos obligatorios | D-LEG-04, D-RCP-01 |
| **Prácticas de cobranza** | Registro de visitas/contactos auditado; horarios configurables; sin datos de terceros | Política de cobranza por tenant | Restricciones a horarios, medios, contacto con terceros y conducta de gestores de cobranza; registros obligatorios | D-LEG-07 |
| **Retención de información** | Retención configurable, seudonimización, respaldos | — | Plazos mínimos y máximos de conservación de registros financieros, KYC y auditoría | D-LEG-02, D-LEG-03 |
| **Residencia de datos y proveedores** | Infraestructura parametrizable por región | Proveedor cloud, SMS/WhatsApp | Restricciones de transferencia internacional u hospedaje | D-ARC-04, D-BIZ-02 |
| **Firma electrónica de contratos** | Registro de aceptación con evidencia (hash, hora, dispositivo) | Uso de contratos digitales | Validez de la aceptación electrónica y requisitos de conservación | D-LEG-08 |
| **Reportes a burós de crédito** | Exportación estructurada (futuro) | Si se reporta | Obligaciones de reporte/consulta y consentimiento | D-LEG-09 |

## 3. Bloqueos regulatorios por feature

| Feature | Puede especificarse/desarrollarse | Puede salir a producción sin validación legal |
|---|---|---|
| 001, 002, 006, 011, 015 | Sí | Sí (controles técnicos) |
| 003 customer-management | Sí | No hasta D-LEG-02 y D-LEG-03 |
| 004, 005, 007 préstamos | Sí | No hasta D-LEG-05, D-LEG-06, D-FIN-10 |
| 008 programmed-savings | Sí, como diseño | **No hasta D-SAV-04 y D-LEG-06** |
| 009 savings-collateral | Sí | No hasta D-COL-02 y D-SAV-04 |
| 010, 012, 013 campo/recibos/caja | Sí | No hasta D-LEG-04 y prácticas de cobranza |
| 014 customer-portal | Sí | No hasta D-LEG-02 y D-LEG-05 |

## 4. Próximo paso

Contratar revisión legal y regulatoria especializada **una vez confirmado el país (D-LEG-01)**, entregando este documento,
`docs/business/financial-domain.md` y las specs 008/009 como insumo.
