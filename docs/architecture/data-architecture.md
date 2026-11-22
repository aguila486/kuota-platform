# Arquitectura de datos

> Estado: Propuesto (2026-11-22). ADR-0004 (PostgreSQL 18 + Prisma, D-ARC-01), ADR-0005 (ledger, D-FIN-01, D-LED-01).
> El modelo detallado de cada capacidad se define en `specs/NNN-*/data-model.md`; este documento fija las reglas.

## 1. Estrategia de multi-tenancy

**Base compartida, esquema compartido, columna `tenant_id` + Row-Level Security forzado.**

| Alternativa | Aislamiento | Costo operativo | Decisión |
|---|---|---|---|
| BD por tenant | Máximo | Alto (migraciones × N, conexiones) | Descartada en v1 |
| Esquema por tenant | Alto | Medio-alto | Descartada |
| Esquema compartido + RLS | Alto si se fuerza y prueba | Bajo | **Elegida** |

Política estándar aplicada a cada tabla con datos de tenant:

```sql
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loans
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

`nullif` es obligatorio: si la conexión ya usó `set_config(..., true)` en una transacción anterior, la variable vale
`''` (no `NULL`) y un cast directo a `uuid` fallaría en vez de devolver 0 filas (ADR-0004, criterio S1).

CI verifica en el esquema `kuota` (consulta a `pg_class`/`pg_policies`) que toda tabla con columna `tenant_id` tiene RLS habilitado,
forzado y con política. Claves foráneas compuestas `(tenant_id, id)` en relaciones entre tablas de tenant para
impedir referencias cruzadas.

## 2. Roles de base de datos

| Rol | Uso | Privilegios |
|---|---|---|
| `kuota_migrator` | Pipeline de migraciones | Owner de esquemas/tablas. Nunca usado por la app |
| `kuota_app` | API (`NOLOGIN`) | DML limitado; **sin** `BYPASSRLS`; sin `UPDATE/DELETE` en ledger y auditoría |
| `kuota_app_login` | Credencial de la API | `LOGIN`, miembro de `kuota_app` |
| `kuota_worker` | Worker (ADR-0002, C2-3) | Igual que `kuota_app` + tablas de cola; se crea con la primera feature con jobs |
| `kuota_platform` | platform-admin | Acceso a `tenants`/`memberships`; acceso cross-tenant solo vía funciones `SECURITY DEFINER` auditadas |
| `kuota_readonly` | Reportes/soporte | `SELECT` con RLS |

## 3. Identidad global vs datos por tenant

```mermaid
erDiagram
    IDENTITIES ||--o{ MEMBERSHIPS : "staff en"
    IDENTITIES ||--o{ CUSTOMERS : "es cliente (vínculo opcional)"
    TENANTS ||--o{ MEMBERSHIPS : tiene
    TENANTS ||--o{ CUSTOMERS : tiene
    TENANTS ||--o{ BRANCHES : tiene
    IDENTITIES {
        uuid id PK
        text phone_e164 "único global"
        text status
    }
    CUSTOMERS {
        uuid tenant_id PK
        uuid id PK
        uuid identity_id FK "nullable"
        text full_name
        text kyc_status
    }
    MEMBERSHIPS {
        uuid tenant_id
        uuid identity_id
        text role
        uuid branch_id
    }
```

`identities` **no** tiene `tenant_id` y no contiene datos de negocio; no tiene RLS de tenant sino política por
`app.identity_id`. Una persona cliente de dos empresas = 1 `identity` + 2 `customers` independientes (KYC y documentos
duplicados por tenant). Ninguna empresa puede consultar qué otras empresas atienden a la misma identidad.

## 4. Modelo de alto nivel por módulo

```mermaid
erDiagram
    LOAN_PRODUCTS ||--o{ LOAN_PRODUCT_VERSIONS : versiona
    LOAN_PRODUCT_VERSIONS ||--o{ LOANS : "condiciones congeladas"
    CUSTOMERS ||--o{ LOANS : tiene
    LOANS ||--o{ LOAN_INSTALLMENTS : calendario
    LOANS ||--o{ PAYMENTS : recibe
    PAYMENTS ||--o{ PAYMENT_ALLOCATIONS : "aplica a"
    LOAN_INSTALLMENTS ||--o{ PAYMENT_ALLOCATIONS : recibe
    SAVINGS_PLAN_VERSIONS ||--o{ SAVINGS_ACCOUNTS : "condiciones"
    CUSTOMERS ||--o{ SAVINGS_ACCOUNTS : tiene
    SAVINGS_ACCOUNTS ||--o{ SAVINGS_DEPOSITS : recibe
    SAVINGS_ACCOUNTS ||--o{ COLLATERAL_PLEDGES : garantiza
    LOANS ||--o{ COLLATERAL_PLEDGES : "respaldado por"
    JOURNAL_ENTRIES ||--|{ JOURNAL_LINES : "≥2 líneas"
    LEDGER_ACCOUNTS ||--o{ JOURNAL_LINES : afecta
    PAYMENTS ||--|| JOURNAL_ENTRIES : contabiliza
    SAVINGS_DEPOSITS ||--|| JOURNAL_ENTRIES : contabiliza
    JOURNAL_ENTRIES ||--o| JOURNAL_ENTRIES : "reverses_entry_id"
    PAYMENTS ||--o| RECEIPTS : comprueba
    COLLECTOR_SHIFTS ||--o{ PAYMENTS : "capturado en"
    COLLECTOR_SHIFTS ||--o| CASH_COUNTS : "cierra con"
```

Principios del modelo:
- Productos **versionados**: un préstamo referencia la versión con la que se otorgó; cambiar un producto no altera
  préstamos vigentes.
- Calendarios y estados de cuota son **proyecciones operativas**; el dinero está en el ledger.
- Operaciones financieras (`payments`, `savings_deposits`) son inmutables una vez confirmadas; se revierten con
  operación de reverso + asiento de reverso.

## 5. Ledger

```text
ledger_accounts(tenant_id, id, code, name, type[ASSET|LIABILITY|INCOME|EXPENSE|EQUITY|MEMO], currency,
                owner_type, owner_id)           -- p.ej. cartera del préstamo X, ahorro del cliente Y, caja del cobrador Z
journal_entries(tenant_id, id, entry_type, effective_date, posted_at, idempotency_key UNIQUE per tenant,
                reverses_entry_id NULL, source_type, source_id, actor_id, correlation_id)
journal_lines(tenant_id, id, entry_id, account_id, direction[DEBIT|CREDIT], amount_minor BIGINT CHECK (>0), currency)
account_balances(tenant_id, account_id, balance_minor, last_entry_id)  -- proyección reconstruible
```

- Trigger de base de datos rechaza `UPDATE`/`DELETE` en `journal_entries` y `journal_lines` (además de los grants).
- Trigger diferido (`DEFERRABLE INITIALLY DEFERRED`) valida Σdébitos = Σcréditos por asiento y moneda al commit.
- Job de reconciliación compara `account_balances` contra la suma de `journal_lines` y alerta ante diferencia.

## 6. Tipos de datos

| Concepto | Tipo PostgreSQL | TypeScript | Dart |
|---|---|---|---|
| Montos | `BIGINT` unidades mínimas + `CHAR(3)` moneda | `bigint` | `BigInt` (móvil y web; nunca `int`)* |
| Tasas, factores | `NUMERIC(18,10)` + `rate_basis` (D-FIN-03) | `Decimal` (decimal.js) | `Decimal` (paquete `decimal`) |
| Fechas de negocio | `DATE` + zona horaria del tenant | `Temporal`/lib de fechas sin hora | `DateTime` fecha pura |
| Instantes | `TIMESTAMPTZ` | — | UTC |
| IDs | `UUID` (v7 para ordenabilidad) | string | string |

\* Representación, rangos, escalas, forma canónica en JSON y conversión de presentación: **ADR-0007** (D-FIN-01,
aprobada). En Flutter Web `int` es un número de JavaScript; por eso los montos son `BigInt` en todas las plataformas.

## 7. Auditoría

`audit_events` — append-only (mismos controles que el ledger), escrita por `common/audit` en la misma transacción del
caso de uso. Definición canónica en `specs/001-platform-foundation/data-model.md` (incluye `actor_role`, nulo en 001 y
derivado del contexto de autorización desde 002). `changes` excluye secretos y minimiza PII. El módulo `audit` (015)
solo la consulta (ADR-0002).

## 8. Migraciones

- Prisma Migrate genera SQL; RLS, grants, triggers y funciones se agregan como SQL manual en la misma migración.
- Patrón **expand → migrate → contract**: agregar columnas nullable/tablas nuevas, desplegar código compatible,
  backfill, y solo en un release posterior eliminar lo viejo. Cambios destructivos requieren fase de contract aprobada.
- Migraciones se aplican en pipeline con `kuota_migrator` antes de desplegar la nueva versión. Si `/health/ready`
  también verifica las migraciones aplicadas es la decisión pendiente D-ARC-06; en 001 solo verifica la base de datos.
- Prueba de CI: aplicar todas las migraciones sobre BD vacía + sobre snapshot del esquema de `main`.

## 9. Respaldos y retención

- Respaldos con PITR (WAL) en staging/producción; restauración probada periódicamente (procedimiento en resiliencia).
- Retención: ledger, operaciones financieras y auditoría **no se eliminan** durante el periodo legal (PENDIENTE-LEGAL,
  D-LEG-02/D-LEG-03). PII de clientes inactivos: política de anonimización pendiente de validación legal.
- Respaldos cifrados; acceso restringido y auditado.
