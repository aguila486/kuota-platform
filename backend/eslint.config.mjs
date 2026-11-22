// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Acceso a datos solo a través de `withTenant` (ADR-0004 C4-2, research R-04): el cliente de base de datos crudo
// (Prisma o, si se activa el fallback, el driver `pg`) solo puede importarse en src/common/tenant-context/.
const RAW_DB_CLIENT_MESSAGE =
  'Acceso a datos solo vía withTenant (src/common/tenant-context). El cliente crudo de base de datos está prohibido fuera de ahí (ADR-0004).';

export default defineConfig(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
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
          patterns: [{ group: ['@prisma/*', '.prisma/*', '**/generated/prisma/**'], message: RAW_DB_CLIENT_MESSAGE }],
        },
      ],
    },
  },
  prettier,
);
