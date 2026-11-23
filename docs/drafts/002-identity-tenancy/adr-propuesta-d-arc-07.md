# Propuesta de ADR: propiedad de tablas por módulo (D-ARC-07)

> **BORRADOR — PROPUESTA (2026-11-23). No aprobada.** No se registra en `docs/decisions/` hasta la aprobación del
> responsable. Si se aprueba, se convierte en ADR-0008 y cierra la condición C2-2 de ADR-0002.

- **Relacionado:** Constitución III (aislamiento), VIII (Clean Architecture), IX (modularidad: un módulo "NO DEBE"
  acceder a tablas de otro); ADR-0002 (C2-1 transacciones, C2-2 propiedad de tablas, enmienda 1 `index.ts`); ADR-0004
  (Prisma 7, P1–P8); `docs/architecture/data-architecture.md` §2–3; `docs/security/multi-tenant-isolation.md` §7–9.

## 1. Situación actual (verificada en el código, HEAD `1831bde`)

| Aspecto | Hoy | Consecuencia para D-ARC-07 |
|---|---|---|
| Esquema Prisma | Un solo `backend/prisma/schema.prisma`, todos los modelos en el esquema PostgreSQL `kuota` | Cualquier modelo es accesible desde cualquier transacción |
| Acceso a datos | Un único `TenantPrismaService.withTenant(fn)` (`common/tenant-context`), cuyo cliente protegido expone **todos** los modelos (`MODELS = Prisma.ModelName`) | Un módulo puede escribir `tx.<modelo_de_otro_módulo>`: nada lo impide |
| Reglas de dependencias | dependency-cruiser: Prisma solo en `common/tenant-context`; módulos solo vía `index.ts` de otros | Controla *imports*, no qué modelo usa cada módulo (lo reconoce ADR-0002 C2-2) |
| RLS | Política `tenant_isolation` (`tenant_id = app.tenant_id`) + `FORCE` en las 3 tablas; `db:check-rls` verifica toda tabla con `tenant_id` | RLS aísla **tenants**, no **módulos** |
| Migraciones | Carpeta secuencial única (`0001_…`, `0002_…`), SQL con `BEGIN/COMMIT` (P1) | Toda tabla nace en una migración global |
| Tablas | `idempotency_keys`, `audit_events` (de `common`), `dev_probe_items` (módulo técnico) | 002 crearía las primeras tablas de negocio |

## 2. Alternativas

**A. Cada módulo es propietario exclusivo de sus tablas.** Solo el módulo propietario lee y escribe sus tablas; los
demás usan su API pública (`index.ts`).

**B. Algunos módulos comparten tablas mediante repositorios comunes.** Un repositorio compartido (p. ej. de
usuarios/membresías) que varios módulos usan directamente.

**C. Un módulo `identity` centraliza la identidad global, y otros módulos mantienen membresías y datos específicos.**
Es una **descomposición** concreta; puede aplicarse con la regla A (cada módulo dueño de lo suyo) o con la B.

| Criterio | A | B | C (bajo la regla A) |
|---|---|---|---|
| Ventajas | Cumple Constitución IX literalmente; límites verificables; extracción futura sencilla | Menos código de API interna; consultas cruzadas directas | Separa lo global (identidad) de lo que es por tenant (membresías, roles): encaja con Constitución III y `data-architecture.md` §3 |
| Desventajas | Más API interna (llamadas entre módulos); joins entre módulos imposibles en SQL directo (se resuelven en la API o con vistas de solo lectura del propietario) | **Contradice Constitución IX** ("NO DEBEN acceder a tablas de otro módulo directamente"); el repositorio común se convierte en un módulo "dios" | Requiere definir con cuidado qué es global y qué es por tenant |
| Dependencias | Manifiesto de propiedad + verificador + lint por modelo | Ninguna nueva, pero erosiona límites | Igual que A, más el contexto de identidad (§4.3) |
| Transacciones | Atomicidad entre módulos con C2-1: el caso de uso abre `withTenant` y llama a las APIs públicas, que reutilizan la transacción activa | Igual | Igual; el login (sin tenant) necesita un contexto de identidad (§4.3) |
| Prisma | Esquema multiarchivo por módulo (`prisma/schema/<módulo>.prisma`; soporte a verificar en 7.10.1, como dice ADR-0002) y lint: en `modules/<m>/**` solo `tx.<modelo de m>` | Un esquema; sin regla | Igual que A |
| PostgreSQL RLS | Sin cambios para tablas por tenant; las globales (identidad) necesitan política por `app.identity_id` | Igual | Igual que A; `db:check-rls` necesita una lista blanca explícita de tablas globales con su política propia |
| Migraciones | Carpeta global (no cambia); cada migración declara el módulo propietario de cada tabla nueva en el manifiesto, verificado en CI | Sin control | Igual que A |
| Pruebas de aislamiento | MT-01..08 por módulo + verificador de propiedad (toda tabla `kuota.*` con exactamente un propietario; ninguna referencia a modelos ajenos) | No verificables | Igual que A + MT-08 (misma persona en dos tenants) |
| Acoplamiento | Bajo y visible (solo por `index.ts`) | Alto y oculto | Bajo |
| Monolito modular (ADR-0002) | Coherente (es su objetivo) | Lo debilita | Coherente |

**Alternativa más fuerte descartada para v1 (ADR-0002):** un esquema y un rol de PostgreSQL por módulo con
`SET LOCAL ROLE`. Aísla en la base de datos, pero complica las transacciones entre módulos y multiplica los permisos.

## 3. Recomendación técnica

**Regla A** (propiedad exclusiva) **con la descomposición C**, implementada con el mecanismo que ADR-0002 ya propone:

1. `backend/db/table-ownership.json`: tabla → módulo propietario, con clasificación `tenant` | `global-identity` |
   `platform`. Un verificador de catálogo, junto a `db:check-rls`, falla si una tabla de `kuota` no tiene exactamente
   un propietario o si su clasificación no coincide con su política RLS.
2. Modelos Prisma por módulo y regla de lint: en `src/modules/<m>/**` solo `tx.<modelo>` de los modelos de `<m>`; el
   SQL crudo, en archivos por módulo, revisado por un script.
3. Datos de otro módulo solo por su `index.ts`; atomicidad con C2-1.
4. Prueba negativa en `scripts/ci/prove-gates.sh`: un módulo que usa un modelo ajeno → el gate falla.

## 4. Arquitectura propuesta para 002 (bajo A + C)

### 4.1 Tres planos que no se mezclan

| Plano | Qué es | Dónde vive | Ejemplo |
|---|---|---|---|
| **Identidad global** | Quién es la persona y cómo se autentica, sin datos de negocio | `identity` (tablas globales, RLS por `app.identity_id`) | teléfono verificado, credenciales, factores |
| **Identidad por tenant** | Qué es esa persona *en* una empresa | `access` (membresías de staff/cobrador) y, en 003, `customers` (cliente) | membresía de cobrador en el tenant X |
| **Autorización por tenant** | Qué puede hacer en esa empresa | `access` (roles y permisos por tenant) | permiso `loan.disburse` en el tenant X |

### 4.2 Módulos y tablas propuestas

| Entidad | Módulo propietario | Clasificación | RLS propuesta | Notas |
|---|---|---|---|---|
| `tenants` | `tenancy` | platform | Lectura de la propia fila con `id = app.tenant_id` (`kuota_app`); alta y cambios solo por `platform-admin` mediante funciones `SECURITY DEFINER` auditadas (`kuota_platform`) | Los datos de alta dependen de D-LEG-06 |
| `branches` | `tenancy` | tenant | `tenant_isolation` + FORCE | |
| `identities` | `identity` | global-identity | `id = app.identity_id` | Sin `tenant_id` ni datos de negocio (`data-architecture.md` §3) |
| `identity_credentials`, `identity_factors` (contraseña Argon2id, TOTP cifrado) | `identity` | global-identity | por `app.identity_id` | Secretos TOTP cifrados (custodia de llaves: D-ARC-04) |
| `memberships` | `access` | tenant | `tenant_isolation` + FORCE | `identity_id`, rol, sucursal opcional, estado |
| `roles`, `role_permissions` | `access` | tenant | `tenant_isolation` + FORCE | Roles por tenant; catálogo inicial pendiente |
| `permissions` | `access` | catálogo del sistema (sin `tenant_id`) | Solo lectura para `kuota_app` | Definido en código y migración; no editable por tenants |
| `devices` | `devices` | global-identity | por `app.identity_id` | Llave pública, plataforma, estado |
| `device_tenant_approvals` | `devices` | tenant | `tenant_isolation` + FORCE | Aprobación del cobrador por un administrador del tenant |
| `sessions`, `refresh_tokens` | `sessions` | global-identity | por `app.identity_id` | Hash del refresh, familia, rotación, revocación |
| `otp_challenges` | `identity` | global (pre-autenticación) | Sin acceso de `kuota_app`; solo funciones `SECURITY DEFINER` | Vida ≤ 5 min, un solo uso, intentos limitados |
| `platform_operators` | `platform-admin` | platform | Sin acceso de `kuota_app`; rol `kuota_platform` | MFA resistente a phishing; break-glass auditado |
| `audit_events` | `common` (sin cambios) | tenant | sin cambios | Los actores pasan de `dev:*` a identidades reales |

### 4.3 Contextos de ejecución (impacto en `common/tenant-context`)

- **Tenant** (existente): `withTenant` fija `app.tenant_id` (+ actor). Lo usan todos los módulos por tenant.
- **Identidad** (nuevo): operaciones de la propia identidad sin tenant (sesiones, dispositivos, lista de membresías
  propias). Requiere `withIdentity` que fije `app.identity_id`, con las mismas garantías de propiedad de la transacción
  de T039. **Cambia `common/tenant-context`**: necesita aprobación expresa (hoy está protegido).
- **Pre-autenticación** (nuevo): login, OTP y recuperación, sin identidad conocida todavía. Propuesta: funciones
  `SECURITY DEFINER` mínimas (p. ej. "buscar identidad por teléfono y devolver solo id y estado") con un rol propio sin
  acceso a datos de negocio, nunca consultas libres. Es el punto más sensible del diseño y requiere decisión.
- **Plataforma** (existente en la arquitectura, no implementado): rol `kuota_platform`, endpoints con prefijo propio.

## 5. Decisiones que esta propuesta deja pendientes

1. Aprobar la regla A con la descomposición C (o elegir otra).
2. Aprobar el mecanismo (manifiesto + verificador + lint por modelo + prueba negativa) y verificar el esquema
   multiarchivo de Prisma 7.10.1 antes de comprometerse (si no está disponible, lint por nombre de modelo en un solo
   esquema).
3. Autorizar la ampliación de `common/tenant-context` con `withIdentity` y el contexto de pre-autenticación.
4. Clasificar `tenants` (lectura propia por RLS frente a solo funciones de plataforma).
5. Catálogo inicial de roles y permisos (no está decidido en ningún documento).
