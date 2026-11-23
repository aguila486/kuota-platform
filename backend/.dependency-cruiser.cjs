/**
 * Reglas de dependencias del backend (Constitución VIII y IX; research R-11; ADR-0002).
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-sin-framework',
      comment: 'domain/ no depende de framework, persistencia ni red (Constitución VIII).',
      severity: 'error',
      from: { path: '(^|/)domain/' },
      to: { path: '(^|/)node_modules/(@nestjs|@prisma|pg|express)(/|$)' },
    },
    {
      name: 'domain-sin-capas-externas',
      comment: 'domain/ no importa infrastructure/ ni interface/ (Constitución VIII).',
      severity: 'error',
      from: { path: '(^|/)domain/' },
      to: { path: '(^|/)(infrastructure|interface)/' },
    },
    // T100 (FR-008; Constitución VIII: el dominio no depende de "NestJS, Prisma, Flutter o HTTP"): el dominio de cada
    // módulo y `common/money` (dominio puro, plan.md) solo dependen de lo que se lista aquí. Listas de permitidos, no de
    // prohibidos: un paquete nuevo, un alias o un import que no resuelve falla por defecto.
    {
      name: 'dominio-puro-solo-paquetes-permitidos',
      comment:
        'domain/ y common/money solo usan el paquete decimal.js (incluye imports de tipo, reexportaciones e import() dinámico).',
      severity: 'error',
      from: { path: ['(^|/)domain/', '^src/common/money/'] },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg', 'npm-unknown'],
        pathNot: '(^|/)node_modules/decimal[.]js(/|$)',
      },
    },
    {
      name: 'dominio-puro-sin-dependencias-no-resueltas',
      comment: 'Un import que no resuelve (alias, paquete no instalado) no puede saltarse las listas de permitidos.',
      severity: 'error',
      from: { path: ['(^|/)domain/', '^src/common/money/'] },
      to: { couldNotResolve: true },
    },
    {
      name: 'dominio-puro-sin-red-ni-sistema',
      comment:
        'Sin red, procesos ni sistema de archivos de Node en el dominio (crypto, util y similares sí están permitidos).',
      severity: 'error',
      from: { path: ['(^|/)domain/', '^src/common/money/'] },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(http|https|http2|net|tls|dgram|dns|dns/promises|child_process|cluster|worker_threads|inspector|fs|fs/promises|readline|repl|vm)$',
      },
    },
    {
      name: 'dominio-solo-codigo-propio',
      comment:
        'El dominio de un módulo solo importa su propio dominio y common/money (ni infraestructura ni contexto).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/domain/' },
      to: { path: '^src/', pathNot: ['^src/modules/$1/domain/', '^src/common/money/'] },
    },
    {
      name: 'money-solo-codigo-propio',
      comment: 'common/money solo importa common/money y el tipo de error problem.ts (sin dependencias).',
      severity: 'error',
      from: { path: '^src/common/money/' },
      to: { path: '^src/', pathNot: ['^src/common/money/', '^src/common/errors/problem[.]ts$'] },
    },
    {
      name: 'problema-sin-dependencias',
      comment: 'problem.ts no depende de nada: así la excepción de common/money no abre un camino a frameworks.',
      severity: 'error',
      from: { path: '^src/common/errors/problem[.]ts$' },
      to: {},
    },
    {
      name: 'modulos-solo-api-publica',
      comment: 'Un módulo solo importa el index.ts público de otro módulo (Constitución IX, R-11; decisión G7a).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/[^/]+/', pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'] },
    },
    {
      name: 'common-no-importa-modulos',
      comment: 'common/ es transversal y no depende de módulos de negocio.',
      severity: 'error',
      from: { path: '^src/common/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'sonda-bd-solo-health',
      comment: 'La sonda técnica de PostgreSQL (T028) solo la usa el módulo health; no es una vía de acceso a datos.',
      severity: 'error',
      from: { path: '^src/', pathNot: ['^src/common/database/', '^src/modules/health/'] },
      to: { path: '^src/common/database/' },
    },
    {
      name: 'modulo-no-importa-su-propio-index',
      comment: 'El index.ts es solo para otros módulos: importarlo desde dentro del propio módulo crea ciclos (G7a).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/', pathNot: '^src/modules/[^/]+/index\\.ts$' },
      to: { path: '^src/modules/$1/index\\.ts$' },
    },
    {
      name: 'cliente-prisma-solo-tenant-context',
      comment: 'El cliente Prisma generado y @prisma/* solo se usan en src/common/tenant-context (ADR-0004 C4-2, P2).',
      severity: 'error',
      from: { path: '^src/', pathNot: ['^src/common/tenant-context/', '^src/generated/'] },
      to: { path: ['^src/generated/', '(^|/)node_modules/(@prisma|\\.prisma)/'] },
    },
    {
      name: 'contexto-solo-lo-establece-tenant-context',
      comment: 'Solo src/common/tenant-context puede fijar el contexto de tenant (T038).',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/common/tenant-context/' },
      to: { path: '^src/common/tenant-context/establish-context\\.ts$' },
    },
    {
      name: 'sin-ciclos',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', '^src/generated/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
