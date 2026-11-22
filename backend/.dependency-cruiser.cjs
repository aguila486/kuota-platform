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
      comment: 'Un módulo solo importa el index.ts público de otro módulo (Constitución IX, R-11).',
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
      name: 'sin-ciclos',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
