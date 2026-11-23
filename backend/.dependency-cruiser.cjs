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
