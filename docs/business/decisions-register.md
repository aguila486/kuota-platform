# Registro de decisiones pendientes

> Fuente única de IDs de decisión usados en specs, ADRs y documentos. Ninguna decisión de esta tabla está aprobada:
> la columna **Recomendación** es la propuesta de arquitectura, no una decisión tomada (Constitución I).
> Al aprobarse una decisión: actualizar **Estado** a `Aprobada (fecha, responsable)`, registrar la elección y, si es
> técnica, crear/actualizar el ADR correspondiente.
>
> Estado: `Pendiente` (negocio/finanzas/tecnología) · `Pendiente-legal` (requiere especialista; no se inventa).
> Fecha de registro: 2026-11-22.

## Entorno y arquitectura

| ID | Pregunta | Alternativas | Impacto | Recomendación | Riesgo si no se decide | Estado | Responsable | Bloquea |
|---|---|---|---|---|---|---|---|---|
| D-ENV-01 | ¿Cómo actualizar Flutter (3.24.3/Dart 3.5.3 no soporta pub workspaces, requiere Dart ≥ 3.6)? | Upgrade global · FVM por proyecto · No usar pub workspaces | Afecta otros proyectos locales y CI | FVM con versión fijada en `.fvmrc` | No se puede crear `flutter/` | **Aprobada (2026-11-22, responsable del proyecto): FVM por proyecto** | Tecnología | 001 (tareas Flutter) |
| D-ARC-01 | ¿ORM? | Prisma · TypeORM · Drizzle/Kysely | Patrón RLS, migraciones, tipado | Prisma, condicionado a spike RLS + pooling | Retrabajo de capa de datos | Pendiente | Tecnología | 001 (spike), 002+ |
| D-ARC-02 | ¿Gestión de estado Flutter? | Riverpod · Bloc | Arquitectura de las 3 apps | Riverpod | Inconsistencia entre apps | Pendiente | Tecnología | 001 (apps), 010, 014 |
| D-ARC-03 | ¿Admin en Flutter Web? | Flutter Web · React/Next | Reutilización vs UX web/SEO/tablas | Flutter Web inicial, revisar tras MVP | Bajo en fase inicial | Pendiente | Tecnología/Producto | admin_web |
| D-ARC-04 | ¿Proveedor cloud/hosting? | AWS · GCP · Azure · otros | Costos, residencia, servicios gestionados | Pendiente; no aprovisionar | Bloquea staging/prod | Pendiente | Tecnología/Negocio | despliegue |
| D-ARC-05 | ¿Ventana de soporte de apps móviles antiguas? | N-1 · N-2 · por días | Compatibilidad API/sync | N-2 versiones o 90 días | Operaciones offline no sincronizables | Pendiente | Producto/Tecnología | 011, contratos |

## Reglas financieras de préstamo

| ID | Pregunta | Alternativas | Impacto | Recomendación | Riesgo | Estado | Responsable | Bloquea |
|---|---|---|---|---|---|---|---|---|
| D-FIN-01 | ¿Representación de dinero? | BIGINT unidades mínimas · NUMERIC | Esquema, API, Dart | BIGINT unidades mínimas + moneda ISO 4217 | Errores de precisión | Pendiente | Tecnología/Finanzas | 001 (librería money), 006 |
| D-FIN-02 | ¿Modo y punto de redondeo? | HALF_UP · HALF_EVEN; por cuota vs por total | Cuotas, intereses, moratorios | HALF_UP a centavo por cuota; ajuste en última cuota | Diferencias con contratos | Pendiente | Finanzas | 004, 005 |
| D-FIN-03 | ¿Bases de tasa y semántica de FLAT_GLOBAL? | PER_PERIOD · MONTHLY · ANNUAL · TOTAL; conversión proporcional vs efectiva | Costo para el cliente, divulgación | Base explícita; FLAT_GLOBAL: interés = P × tasa total | Cobros incorrectos | Pendiente | Finanzas/Legal | 004, 005 |
| D-FIN-04 | ¿Convención de días en saldo insoluto? | Tasa por periodo · Actual/360 · Actual/365 · 30/360 | Interés por cuota | Tasa por periodo sin días reales en v1 | Interés distinto al esperado | Pendiente | Finanzas | 004, 005 |
| D-FIN-05 | ¿Días inhábiles y feriados? | Mover al siguiente hábil · anterior · mantener | Calendarios, moratorios | Calendario por tenant; siguiente hábil sin interés adicional | Moratorios injustos | Pendiente | Negocio | 004, 005 |
| D-FIN-06 | ¿Moratorios: base, tope, gracia? | Base capital vs capital+interés; con/sin tope; gracia incluida/excluida | Ingreso, quejas, regulación | Tope configurable; base = cuota vencida no pagada | Cargos abusivos | Pendiente | Finanzas/Legal | 004, 007 |
| D-FIN-07 | ¿Prelación entre cuotas y excedentes? | Vertical · horizontal; excedente a futuro/capital/saldo a favor | Morosidad, ingresos | Moratorios → interés → capital, cuota más antigua primero; excedente a saldo a favor | Disputas con clientes | Pendiente | Negocio/Finanzas | 007 |
| D-FIN-08 | ¿Anticipos y liquidación anticipada? | Reducir plazo vs cuota; bonificación en FLAT sí/no | Monto de liquidación | Pendiente negocio; v1 solo adelanto de cuotas y liquidación total | Liquidaciones inconsistentes | Pendiente | Negocio/Finanzas/Legal | 007 |
| D-FIN-09 | ¿Reestructuras? | Nuevo préstamo que liquida · modificación de calendario | Trazabilidad | Nuevo préstamo con vínculo al original | Edición de históricos | Pendiente | Negocio | 007 (fuera de v1) |
| D-FIN-10 | ¿Impuestos sobre intereses/moratorios? | Según jurisdicción | Montos y comprobantes | Requiere especialista | Incumplimiento fiscal | Pendiente-legal | Legal/Fiscal | 005, 007 (producción) |

## Ahorro y garantías

| ID | Pregunta | Alternativas | Impacto | Recomendación | Riesgo | Estado | Responsable | Bloquea |
|---|---|---|---|---|---|---|---|---|
| D-SAV-01 | ¿Semántica del rendimiento? | % por ciclo sobre aportado · proporcional al tiempo · anual prorrateado · solo si completa | Pasivo de la empresa | % por ciclo sobre aportaciones pagadas; nunca anualizar automáticamente | Promesas de rendimiento erróneas | Pendiente | Finanzas | 008 |
| D-SAV-02 | ¿Aportaciones atrasadas? | Aceptar hasta cierre · penalizar · rechazar | Rendimiento, operación | Aceptar dentro del ciclo; rendimiento solo si se confirma antes del cierre | Conflictos con clientes | Pendiente | Negocio | 008, 010 |
| D-SAV-03 | ¿Cancelación anticipada? | Capital sin rendimiento · proporcional · penalización | Pasivo, liquidez | Capital sin rendimiento, con autorización | Disputas | Pendiente | Negocio/Legal | 008 |
| D-SAV-04 | ¿Naturaleza regulatoria del ahorro (captación del público)? | Según figura jurídica y país | Puede impedir ofrecer el producto | Dictamen legal antes de producción | Sanciones regulatorias graves | **Pendiente-legal (crítico)** | Legal | 008, 009, 014 (producción) |
| D-COL-01 | ¿Base de garantía y préstamos simultáneos? | Aportado confirmado · con rendimiento; simultáneos sí/no | Límite de crédito | Solo aportaciones confirmadas; Σ reservas ≤ % configurado | Sobreexposición | Pendiente | Finanzas | 009 |
| D-COL-02 | ¿Compensación del ahorro por incumplimiento? | Al vencimiento · anticipada · no compensar | Recuperación, derechos del cliente | Al vencimiento, con consentimiento contractual | Retención indebida de ahorro | Pendiente-legal | Legal/Negocio | 009 |

## Ledger, sincronización, recibos y caja

| ID | Pregunta | Alternativas | Impacto | Recomendación | Riesgo | Estado | Responsable | Bloquea |
|---|---|---|---|---|---|---|---|---|
| D-LED-01 | ¿Alcance del ledger v1? | Subledger operativo · contabilidad general completa | Modelo de datos, reportes | Subledger de partida doble con plan de cuentas plantilla; contabilidad general fuera de alcance | Saldos irreconciliables | Pendiente | Finanzas/Tecnología | 006 |
| D-LED-02 | ¿Base de reconocimiento de intereses (devengo vs cobro)? | Devengo por cuota vencida · devengo diario · reconocimiento al cobro | Asientos, reportes de ingresos, moratorios | Devengo al vencimiento de cada cuota (pendiente Finanzas) | Ingresos mal reconocidos | Pendiente | Finanzas | 006, 007 |
| D-SYNC-01 | ¿Pagos concurrentes de varios cobradores / sobrepago? | Aceptar ambos · rechazar segundo · bloquear préstamo por cobrador | Efectivo real vs saldo | Aceptar ambos; sobrepago → REQUIRES_REVIEW | Pérdida de efectivo no registrado | Pendiente | Negocio/Tecnología | 011, 010 |
| D-SYNC-02 | ¿Estados finales de operación offline? | Los 6 propuestos · añadir CANCELLED_LOCAL | UX, auditoría | Validar CREATED_LOCAL, PENDING_SYNC, SYNCING, CONFIRMED, REJECTED, REQUIRES_REVIEW | Estados ambiguos | Pendiente | Producto/Tecnología | 011 |
| D-SYNC-03 | ¿Límites offline? | Horas, efectivo máximo, nº operaciones | Riesgo de fraude/pérdida | 72 h; límites configurables por tenant | Exposición de efectivo | Pendiente | Negocio/Riesgos | 010, 011 |
| D-RCP-01 | ¿Verificación de recibos? | QR firmado + página pública · solo folio · sin verificación | Fraude de recibos, privacidad | QR con token firmado + página pública mínima | Recibos falsificados | Pendiente | Producto/Seguridad | 012 |
| D-RCP-02 | ¿Folios offline? | Prefijo dispositivo + secuencia · bloque de folios reservado | Unicidad sin red | Prefijo de dispositivo + secuencia | Folios duplicados | Pendiente | Tecnología/Legal | 012 |
| D-CSH-01 | ¿Corte con operaciones no sincronizadas? | Bloquear cierre · corte con pendientes | Operación diaria | "Corte con pendientes", ajuste posterior | Cortes falsos | Pendiente | Negocio | 013 |
| D-CSH-02 | ¿Tratamiento de faltantes/sobrantes? | Cargo al cobrador · pérdida · tolerancia | Aspectos laborales | Pendiente negocio/laboral | Conflictos laborales | Pendiente | Negocio/Legal | 013 |

## Autenticación

| ID | Pregunta | Alternativas | Impacto | Recomendación | Riesgo | Estado | Responsable | Bloquea |
|---|---|---|---|---|---|---|---|---|
| D-AUTH-01 | ¿Autenticación de clientes? | OTP en cada login · PIN · OTP + device binding + PIN/biometría | Seguridad (SIM-swap), costo SMS, UX | OTP solo para enrolamiento/recuperación + device binding + PIN/biometría | Toma de cuentas | Pendiente | Seguridad/Producto | 002, 014 |
| D-AUTH-02 | ¿Autenticación de staff? | Password · password + MFA TOTP · SSO | Seguridad del panel | Password + MFA TOTP obligatorio en roles financieros | Accesos indebidos | Pendiente | Seguridad | 002 |

## Legales y comerciales

| ID | Pregunta | Alternativas | Impacto | Recomendación | Riesgo | Estado | Responsable | Bloquea |
|---|---|---|---|---|---|---|---|---|
| D-LEG-01 | ¿País inicial de operación? | — | Todo el marco regulatorio y fiscal | Pendiente (el uso de MXN en ejemplos NO lo confirma) | Diseño para jurisdicción equivocada | Pendiente-legal | Negocio/Legal | producción |
| D-LEG-02 | ¿Ley de protección de datos aplicable? | Según país | Consentimiento, ARCO/derechos, retención | Especialista | Sanciones, pérdida de confianza | Pendiente-legal | Legal | 003, 015 (producción) |
| D-LEG-03 | ¿Obligaciones KYC / prevención de lavado de dinero? | Según país y figura | Datos a recolectar, reportes | Especialista | Sanciones | Pendiente-legal | Legal/Cumplimiento | 003, 005 |
| D-LEG-04 | ¿Comprobantes fiscales vs recibos operativos? | Según país | Diseño de recibos | Especialista | Recibos sin validez requerida | Pendiente-legal | Legal/Fiscal | 012 |
| D-LEG-05 | ¿Topes de tasa y divulgación de costo total? | Según país | Configuración de productos, UI | Especialista | Productos no conformes | Pendiente-legal | Legal | 004, 005 |
| D-LEG-06 | ¿Figura jurídica de los tenants (quién puede prestar/captar)? | Según país | Onboarding de tenants, habilitación de ahorro | Especialista; validar por tenant | Operar con tenants no autorizados | Pendiente-legal | Legal | 002, 008 |
| D-LEG-07 | ¿Restricciones sobre prácticas de cobranza (horarios, medios, contacto con terceros)? | Según país | Rutas, registro de visitas, notificaciones | Especialista; registrar visitas/contactos con auditoría | Sanciones, reputación | Pendiente-legal | Legal | 010, 014 |
| D-LEG-08 | ¿Validez de aceptación/firma electrónica de contratos y conservación? | Firma simple con evidencia · firma avanzada · contrato en papel | Originación digital, evidencia | Especialista; registrar evidencia (hash, hora, dispositivo) | Contratos no exigibles | Pendiente-legal | Legal | 005, 014 |
| D-LEG-09 | ¿Obligaciones de consulta/reporte a burós de crédito? | No reportar · reportar vía integración | Exportaciones, consentimientos | Fuera de alcance v1; especialista | Incumplimiento si es obligatorio | Pendiente-legal | Legal | 005, 015 |
| D-BIZ-01 | ¿Modelo comercial del SaaS? | Por usuario · por cartera · por transacción | Medición de uso | Pendiente comercial | Sin impacto técnico inmediato | Pendiente | Negocio | — |
| D-BIZ-02 | ¿Residencia de datos? | País local · región cloud | Hosting, contratos | Pendiente comercial/legal | Incumplimiento contractual | Pendiente | Negocio/Legal | D-ARC-04 |
