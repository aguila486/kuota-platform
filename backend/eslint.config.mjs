// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Acceso a datos solo a través de `withTenant` (ADR-0004 C4-2, research R-04): el cliente de base de datos crudo
// (Prisma o, si se activa el fallback, el driver `pg`) solo puede importarse en src/common/tenant-context/.
const RAW_DB_CLIENT_MESSAGE =
  'Acceso a datos solo vía withTenant (src/common/tenant-context). El cliente crudo de base de datos está prohibido fuera de ahí (ADR-0004).';

// Contexto de tenant (ADR-0004, condición P2): solo src/common/tenant-context puede fijarlo o cambiar la identidad de la
// sesión. Se rechazan literales y SQL de plantilla con set_config, referencias a app.tenant_id/actor_id/correlation_id y
// SET/RESET de app.*, ROLE, SESSION AUTHORIZATION, row_security o ALL. Limitación conocida: el lint no detecta SQL
// armado por concatenación ni funciones de base de datos; por eso siguen siendo obligatorios RLS forzado, privilegios
// mínimos, consultas parametrizadas y revisión.
const TENANT_CONTEXT_SQL =
  '/set_config|\\bapp\\.(tenant_id|actor_id|correlation_id)\\b|\\b(SET|RESET)\\s+(LOCAL\\s+|SESSION\\s+)?("?app\\.|ROLE\\b|SESSION\\s+AUTHORIZATION|ROW_SECURITY|ALL\\b)/i';
const TENANT_CONTEXT_MESSAGE =
  'El contexto de tenant y la identidad de sesión solo se gestionan en src/common/tenant-context (withTenant). ADR-0004, condición P2.';
// T038: el contexto de tenant/actor solo lo escribe un guard de src/common/tenant-context (establishTenantContext).
const CONTEXT_WRITE_MESSAGE =
  'El contexto de tenant/actor solo lo fija un guard de src/common/tenant-context (establishTenantContext). T038, ADR-0004 P2.';
const CONTEXT_KEYS = '/^(tenantId|actorId|actorType|actorRole)$/';
const CONTEXT_KEY_CONSTANTS = '/^CLS_(TENANT_ID|ACTOR_ID|ACTOR_TYPE|ACTOR_ROLE)$/';
const ESTABLISH_CONTEXT_PATTERN = {
  group: ['**/tenant-context/establish-context', '**/tenant-context/establish-context.js'],
  message: CONTEXT_WRITE_MESSAGE,
};
const DYNAMIC_SQL_MESSAGE =
  'SQL dinámico prohibido fuera de src/common/tenant-context: usa $queryRaw/$executeRaw con plantilla parametrizada (ADR-0004, P2).';

export default defineConfig(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'src/generated/**'] },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/common/tenant-context/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'pg', message: RAW_DB_CLIENT_MESSAGE }],
          patterns: [
            { group: ['@prisma/*', '.prisma/*', '**/generated/prisma/**'], message: RAW_DB_CLIENT_MESSAGE },
            ESTABLISH_CONTEXT_PATTERN,
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.property.name=/^(set|setIfUndefined)$/][arguments.0.value=${CONTEXT_KEYS}]`,
          message: CONTEXT_WRITE_MESSAGE,
        },
        {
          selector: `CallExpression[callee.property.name=/^(set|setIfUndefined)$/][arguments.0.name=${CONTEXT_KEY_CONSTANTS}]`,
          message: CONTEXT_WRITE_MESSAGE,
        },
        { selector: `Literal[value=${TENANT_CONTEXT_SQL}]`, message: TENANT_CONTEXT_MESSAGE },
        { selector: `TemplateElement[value.raw=${TENANT_CONTEXT_SQL}]`, message: TENANT_CONTEXT_MESSAGE },
        {
          selector: 'CallExpression[callee.property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
          message: DYNAMIC_SQL_MESSAGE,
        },
        { selector: "MemberExpression[object.name='Prisma'][property.name='raw']", message: DYNAMIC_SQL_MESSAGE },
      ],
    },
  },
  {
    // Excepción acotada (T028): la sonda técnica de conectividad de /health/ready puede importar `pg` y solo ejecuta
    // `SELECT 1` con kuota_app_login. Prisma sigue prohibido y las reglas P2 de SQL siguen activas en este archivo.
    files: ['src/common/database/pg-connectivity-probe.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@prisma/*', '.prisma/*', '**/generated/prisma/**'], message: RAW_DB_CLIENT_MESSAGE },
            ESTABLISH_CONTEXT_PATTERN,
          ],
        },
      ],
    },
  },
  prettier,
);
