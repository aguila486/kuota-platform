# Resiliencia

> Estado: **Propuesto** · 2026-11-22 · Principios: **VI. Idempotencia**, **XI. Offline Resilience**, **XIII. Observabilidad**.
> Relacionado: ADR-0006 (sincronización por comandos), `docs/architecture/offline-architecture.md`.

## 1. Fallos de red

| Escenario | Comportamiento esperado |
|---|---|
| Sin conectividad (Collector) | Operación normal sobre BD local; comandos en outbox (CREATED_LOCAL → PENDING_SYNC); recibos provisionales |
| Petición enviada, respuesta perdida | Reintento con la misma `operation_id`; el servidor devuelve el resultado original (INV-07) |
| Conectividad intermitente durante sync | Envío por lotes pequeños; cada comando se confirma individualmente; reanudación desde el último no confirmado |
| Descarga de snapshot interrumpida | Descarga incremental por cursor; aplicación atómica por lote en Drift |
| Servidor no disponible | Apps en modo degradado (lectura local, cola de comandos); admin muestra estado de indisponibilidad |
| Reloj del dispositivo desfasado | Se registran hora de dispositivo y de servidor; desfase > umbral → advertencia y REQUIRES_REVIEW si afecta fechas contables |

## 2. Reintentos, timeouts y backoff

| Cliente → destino | Timeout | Reintentos | Política |
|---|---|---|---|
| Apps → Kuota Core (lectura) | 10 s | 3 | Backoff exponencial con *jitter* (0.5 s, 1 s, 2 s) |
| Collector → sync (comandos) | 30 s por lote | Ilimitados en el tiempo, con backoff hasta 15 min | Solo operaciones idempotentes; nunca se genera una nueva clave en un reintento |
| Kuota Core → PostgreSQL | `statement_timeout` 5 s (API), mayor para jobs | 1 reintento en errores de serialización/deadlock | Transacción completa se reintenta, no sentencias sueltas |
| Kuota Core → proveedores externos (SMS/WhatsApp) | 5 s | 3 | Vía outbox + worker; *circuit breaker* |

Reglas: solo se reintenta lo idempotente; los errores 4xx de validación no se reintentan (pasan a REJECTED con motivo);
los 409 de conflicto de negocio pasan a REQUIRES_REVIEW.

## 3. Idempotencia como base de la resiliencia

- Clave generada por el originador (UUIDv7 en el dispositivo) y persistida **antes** del primer envío.
- Servidor: `UNIQUE (tenant_id, idempotency_key)` + almacenamiento de la respuesta; misma clave y contenido distinto → error explícito.
- Efectos externos (notificaciones, eventos) vía **outbox transaccional**: se escriben en la misma transacción que el
  cambio de estado y se publican después; los consumidores son idempotentes.

## 4. Degradación controlada

| Dependencia caída | Degradación |
|---|---|
| Proveedor SMS/WhatsApp | Enrolamiento/recuperación de clientes no disponible; el resto opera; reintento diferido de notificaciones |
| Workers de reconciliación/reportes | API transaccional sigue operando; alertas por atraso |
| Almacenamiento de documentos | Alta de documentos pospuesta; operaciones financieras no afectadas |
| Base de datos | Readiness falla → el balanceador deja de enviar tráfico; Collector sigue offline |

## 5. Health checks

- `GET /health/live`: proceso vivo (sin dependencias).
- `GET /health/ready`: PostgreSQL accesible, migraciones al día, configuración válida.
- Las apps consultan versión mínima soportada (principio XIV) y muestran aviso de actualización.

## 6. Respaldos y recuperación — propuesta (PENDIENTE de aprobación, D-ARC-04)

| Métrica | Propuesta inicial | Justificación |
|---|---|---|
| RPO (pérdida máxima de datos) | ≤ 5 min (PITR con WAL continuo) | Operaciones financieras confirmadas no deben perderse; el Collector conserva su outbox hasta confirmación |
| RTO (tiempo de recuperación) | ≤ 4 h | Collector opera offline hasta 72 h, lo que amortigua la indisponibilidad de campo |
| Retención de respaldos | 35 días + mensuales según política legal (PENDIENTE-LEGAL) | — |
| Pruebas de restauración | Mensual, en entorno aislado, con job de reconciliación tras restaurar | Un respaldo no probado no cuenta |

Respaldos cifrados e inmutables (protección contra borrado malicioso, R-08).

## 7. Pruebas de caos básicas

| ID | Experimento | Resultado esperado |
|---|---|---|
| CH-01 | Cortar red del Collector a mitad de un lote de sync | Sin duplicados; reanuda; estados correctos |
| CH-02 | Matar el proceso del backend tras `COMMIT` y antes de responder | Reintento devuelve el resultado original |
| CH-03 | Reiniciar PostgreSQL durante carga | Errores transitorios reintentados; sin asientos parciales (INV-01) |
| CH-04 | Latencia de 5 s y 30 % de pérdida de paquetes | Timeouts y backoff según §2; UI informa estado |
| CH-05 | Forzar deadlocks en pagos concurrentes al mismo préstamo | Reintento de transacción; un solo efecto por clave |
| CH-06 | Matar la app durante escritura en Drift | Outbox consistente al reabrir (transacciones locales) |
| CH-07 | Restaurar respaldo PITR en entorno aislado | Reconciliación sin diferencias |

CH-01..CH-06 se ejecutan automatizados en nightly (con Testcontainers/proxy de fallas tipo Toxiproxy); CH-07 mensual.
