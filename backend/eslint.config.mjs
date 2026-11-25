// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import noUnsafeMoneyNumber from './eslint-rules/no-unsafe-money-number.mjs';

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

// R3 (P2): el cliente transaccional no se retiene más allá de su operación. Se detectan, por su ANOTACIÓN de tipo, los
// campos de clase (incluidas las propiedades de parámetro del constructor) y las variables de módulo `TenantTransaction`.
// Limitación: no detecta campos sin anotación (`this.x = tx`), alias del tipo, colecciones de `any` ni cierres; el
// control efectivo es el de tiempo de ejecución de withTenant (propiedad por operación).
const RETAINED_TX_MESSAGE =
  'No retengas el cliente transaccional (TenantTransaction) en campos ni variables de módulo: recíbelo en el callback de withTenant o pídelo con tenantPrisma.transaction() en cada uso. R3, ADR-0004 P2.';
const TX_TYPE = "TSTypeReference[typeName.name='TenantTransaction']:not(TSFunctionType TSTypeReference)";
const MODULE_VARIABLE = 'VariableDeclaration > VariableDeclarator > Identifier > TSTypeAnnotation';

// Restricciones de sintaxis de seguridad (P2 + T038 + R3). Se reutilizan en los bloques que redefinen no-restricted-syntax:
// ESLint no combina las listas de una misma regla entre bloques, las reemplaza.
const SECURITY_RESTRICTED_SYNTAX = [
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
  { selector: `PropertyDefinition > TSTypeAnnotation ${TX_TYPE}`, message: RETAINED_TX_MESSAGE },
  { selector: `TSParameterProperty ${TX_TYPE}`, message: RETAINED_TX_MESSAGE },
  { selector: `Program > ${MODULE_VARIABLE} ${TX_TYPE}`, message: RETAINED_TX_MESSAGE },
  { selector: `Program > ExportNamedDeclaration > ${MODULE_VARIABLE} ${TX_TYPE}`, message: RETAINED_TX_MESSAGE },
];

// Regla anti punto flotante (T064; R-10; Constitución IV; ADR-0007) en src/common/money/** y src/**/domain/**: prohíbe el
// tipo `number` en parámetros, variables y propiedades cuyo nombre contenga amount|balance|rate|fee|money, y
// `parseFloat`, `Number(…)`, `toFixed` y `Math.round`. El dinero es `bigint` en unidades mínimas (Money).
const FLOAT_MESSAGE =
  'Prohibido punto flotante en código financiero: usa Money (bigint en unidades mínimas) o Decimal. R-10, ADR-0007.';
const MONEY_NAMES = '/(amount|balance|rate|fee|money)/i';
const ANTI_FLOAT_RESTRICTED_SYNTAX = [
  { selector: `Identifier[name=${MONEY_NAMES}] > TSTypeAnnotation TSNumberKeyword`, message: FLOAT_MESSAGE },
  {
    selector: `TSPropertySignature[key.name=${MONEY_NAMES}] > TSTypeAnnotation TSNumberKeyword`,
    message: FLOAT_MESSAGE,
  },
  {
    selector: `PropertyDefinition[key.name=${MONEY_NAMES}] > TSTypeAnnotation TSNumberKeyword`,
    message: FLOAT_MESSAGE,
  },
  {
    selector: `TSParameterProperty > Identifier[name=${MONEY_NAMES}] > TSTypeAnnotation TSNumberKeyword`,
    message: FLOAT_MESSAGE,
  },
  { selector: "CallExpression[callee.name='parseFloat']", message: FLOAT_MESSAGE },
  {
    selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
    message: FLOAT_MESSAGE,
  },
  { selector: "CallExpression[callee.name='Number']", message: FLOAT_MESSAGE },
  { selector: "NewExpression[callee.name='Number']", message: FLOAT_MESSAGE },
  { selector: "CallExpression[callee.property.name='toFixed']", message: FLOAT_MESSAGE },
  { selector: "CallExpression[callee.object.name='Math'][callee.property.name='round']", message: FLOAT_MESSAGE },
];

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'src/generated/**',
      // Casos deliberadamente inseguros de la regla tipada (T104); su prueba los analiza con `ignore: false`.
      'test/fixtures/money-rule/**',
    ],
  },
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
    // T104 (Aprobación 12; FR-021): regla tipada anti punto flotante sobre valores monetarios en todo src/, también
    // en interface/ y application/. En money y domain se añade la aritmética estricta (bloque siguiente).
    files: ['src/**/*.ts'],
    plugins: { kuota: { rules: { 'no-unsafe-money-number': noUnsafeMoneyNumber } } },
    rules: { 'kuota/no-unsafe-money-number': ['error', { strictArithmetic: false }] },
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
      'no-restricted-syntax': ['error', ...SECURITY_RESTRICTED_SYNTAX],
    },
  },
  {
    // T064: código financiero (Money y dominios). Mantiene las restricciones de seguridad y añade la regla anti-float.
    files: ['src/common/money/**/*.ts', 'src/**/domain/**/*.ts'],
    ignores: ['src/common/tenant-context/**'],
    rules: {
      'no-restricted-syntax': ['error', ...SECURITY_RESTRICTED_SYNTAX, ...ANTI_FLOAT_RESTRICTED_SYNTAX],
      'kuota/no-unsafe-money-number': ['error', { strictArithmetic: true }],
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
