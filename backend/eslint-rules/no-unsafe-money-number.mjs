// Regla local `kuota/no-unsafe-money-number` (T104, opción C de la Aprobación 12; FR-021; Constitución IV; ADR-0007).
//
// Interpretación aprobada de FR-021: se prohíbe representar o calcular importes con punto flotante, no el tipo `number`
// en general. La regla usa el comprobador de tipos de TypeScript (servicios de parser de typescript-eslint, ya presentes
// en la configuración): no depende de nombres de variables ni de carpetas para saber qué es dinero.
//
// Valores monetarios (por TIPO, incluidos aliases, inferencia, parámetros, retornos y uniones):
//   - `bigint` en src/common/money, domain/ y src/modules/** (Money usa bigint en unidades mínimas); fuera de ellos,
//     solo las columnas bigint de los modelos de Prisma (los temporizadores bigint de métricas no son dinero);
//   - las clases e interfaces `Money` y `MoneyJson` declaradas en src/common/money/;
//   - `Decimal` de decimal.js (factores y tasas financieras, incluido `MoneyDecimal`);
//   - una propiedad declarada en src/common/money/ (p. ej. `MoneyJson.amount_minor`, string exacto);
//   - y, a través de `String(x)`, `x.toString()`, plantillas, condicionales y constantes locales, lo derivado de ellos.
//
// Errores en todo src/ (mensaje `monetaryToNumber`, etc.):
//   1. conversión de un valor monetario a number: Number(), parseFloat(), parseInt(), Number.parseFloat/parseInt(),
//      Math.*(), más unario, y métodos del valor monetario que devuelven number (p. ej. Decimal#toNumber());
//   2. aserción de un valor monetario a number, any o unknown (evita ocultarlo tras un cast) y variables anotadas como
//      number/any/unknown inicializadas con él;
//   3. BigInt(x) con x: number que no sea un literal entero y sin una comprobación Number.isSafeInteger/isInteger en la
//      función que lo contiene (límite: la comprobación se busca léxicamente, no por flujo de datos);
//   4. Decimal construido u operado con un number que no sea un literal entero (un binario flotante no es exacto).
// Además, con `strictArithmetic: true` (src/common/money/** y src/**/domain/**):
//   5. literales numéricos no enteros; `*`, `/`, `%` y `**` entre numbers; funciones de Math que redondean o calculan
//      (se permiten Math.max, Math.min y Math.abs, exactos sobre enteros).
// Permitido: number para índices, contadores, versiones, escalas, límites y los ratios/partes que admite Money#allocate.
//
// Límites conocidos (complementados fuera de la regla): un número que llega como `any` o desde JSON sin tipar no tiene
// tipo monetario → reglas no-unsafe-*/no-explicit-any de typescript-eslint, validación en la frontera
// (moneyFromJson/parseMoneyField rechazan números JSON) y pruebas de contrato (`amount_minor` string).
import ts from 'typescript';

const MONEY_DIR = '/src/common/money/';
const MONEY_TYPE_NAMES = new Set(['Money', 'MoneyJson']);
const NUMBER_CONVERSIONS = new Set(['Number', 'parseFloat', 'parseInt']);
const NUMBER_STATIC_CONVERSIONS = new Set(['parseFloat', 'parseInt']);
const EXACT_MATH = new Set(['max', 'min', 'abs']);
// Métodos de un valor monetario que devuelven number sin ser un importe: comparaciones, signo y escala.
const NON_AMOUNT_NUMBER_METHODS = new Set(['comparedTo', 'cmp', 'decimalPlaces', 'dp', 'precision', 'sd']);
const GUARDS = new Set(['isSafeInteger', 'isInteger']);

function declaredIn(symbol, test) {
  return (symbol?.declarations ?? []).some((d) => test(d.getSourceFile().fileName.replaceAll('\\', '/')));
}

function isBigIntType(type) {
  if (!type) return false;
  if (type.isUnion()) return type.types.some((t) => isBigIntType(t));
  return (type.flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) !== 0;
}

// `bigintIsMoney`: en src/common/money, en domain/ y en los módulos de negocio (src/modules/**) bigint es la
// representación del dinero; fuera de ellos (métricas, temporizadores…) solo cuentan los bigint con origen monetario
// declarado (propiedades de Money/MoneyJson y columnas bigint de los modelos de Prisma).
function isMonetaryType(type, bigintIsMoney, depth = 0) {
  if (!type || depth > 4) return false;
  if (type.flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) return bigintIsMoney;
  if (type.isUnionOrIntersection()) return type.types.some((t) => isMonetaryType(t, bigintIsMoney, depth + 1));
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (!symbol) return false;
  if (MONEY_TYPE_NAMES.has(symbol.getName()) && declaredIn(symbol, (f) => f.includes(MONEY_DIR))) return true;
  if (symbol.getName() === 'Decimal' && declaredIn(symbol, (f) => f.includes('/decimal.js/'))) return true;
  return false;
}

function isNumberType(type) {
  if (!type) return false;
  if (type.isUnion()) return type.types.every((t) => isNumberType(t));
  return (type.flags & ts.TypeFlags.NumberLike) !== 0;
}

function isLooseType(type) {
  return (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.NumberLike)) !== 0;
}

function isIntegerLiteral(node) {
  if (node.type === 'UnaryExpression' && node.operator === '-') return isIntegerLiteral(node.argument);
  return node.type === 'Literal' && typeof node.value === 'number' && Number.isInteger(node.value);
}

function memberName(node) {
  if (node.type !== 'MemberExpression' || node.computed) return undefined;
  return node.property.type === 'Identifier' ? node.property.name : undefined;
}

function staticMember(node, object) {
  return node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === object
    ? memberName(node)
    : undefined;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Prohíbe representar o calcular importes con punto flotante (FR-021, T104).' },
    schema: [
      {
        type: 'object',
        // `bigintIsMoney` solo lo fijan las pruebas de la regla; en la configuración real se deduce de la ruta.
        properties: { strictArithmetic: { type: 'boolean' }, bigintIsMoney: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      monetaryToNumber:
        'FR-021: convierte un valor monetario ({{type}}) a number (punto flotante). Usa Money (bigint en unidades mínimas) o Decimal y su representación de texto exacta.',
      monetaryAssertion:
        'FR-021: un valor monetario ({{type}}) no puede afirmarse ni guardarse como {{target}}; ocultaría su conversión a number.',
      unsafeBigInt:
        'FR-021: BigInt(number) solo es exacto con un entero seguro. Usa un literal entero, comprueba Number.isSafeInteger en la misma función, o construye desde un string canónico.',
      decimalFromFloat:
        'FR-021: un Decimal no puede construirse ni operarse con un number no entero (binario flotante inexacto). Usa un string decimal o un entero.',
      floatLiteral: 'FR-021: literal numérico no entero en código monetario; usa Money o Decimal con un string.',
      floatArithmetic:
        'FR-021: aritmética {{operator}} entre numbers en código monetario; los importes se calculan con Money (bigint) o Decimal.',
      mathInMoney:
        'FR-021: Math.{{name}} en código monetario; el redondeo de importes es explícito en Money (RoundingMode).',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error('kuota/no-unsafe-money-number requiere información de tipos (parserOptions.projectService)');
    }
    const checker = services.program.getTypeChecker();
    const strict = context.options[0]?.strictArithmetic === true;
    const fileName = context.filename.replaceAll('\\', '/');
    const bigintIsMoney =
      context.options[0]?.bigintIsMoney ??
      (strict || fileName.includes('/src/modules/') || fileName.includes(MONEY_DIR));
    const monetaryType = (type) => isMonetaryType(type, bigintIsMoney);
    const typeOf = (node) => checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
    const typeName = (node) => checker.typeToString(typeOf(node));

    function localInitializer(identifier) {
      let scope = context.sourceCode.getScope(identifier);
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) {
          const def = variable.defs[0];
          return def?.type === 'Variable' && def.parent.kind === 'const' ? def.node.init : undefined;
        }
        scope = scope.upper;
      }
      return undefined;
    }

    function isMonetary(node, depth = 0) {
      if (!node || depth > 6) return false;
      switch (node.type) {
        case 'TSAsExpression':
        case 'TSTypeAssertion':
        case 'TSNonNullExpression':
        case 'TSSatisfiesExpression':
          return isMonetary(node.expression, depth + 1);
        case 'ChainExpression':
          return isMonetary(node.expression, depth + 1);
        case 'ConditionalExpression':
          return isMonetary(node.consequent, depth + 1) || isMonetary(node.alternate, depth + 1);
        case 'LogicalExpression':
          return isMonetary(node.left, depth + 1) || isMonetary(node.right, depth + 1);
        case 'TemplateLiteral':
          return node.expressions.some((e) => isMonetary(e, depth + 1));
        case 'CallExpression': {
          // String(x) y x.toString()/toFixed()/valueOf() conservan el origen monetario como texto.
          if (node.callee.type === 'Identifier' && node.callee.name === 'String')
            return isMonetary(node.arguments[0], depth + 1);
          const name = memberName(node.callee);
          if (name && ['toString', 'toFixed', 'valueOf', 'toJSON'].includes(name))
            return isMonetary(node.callee.object, depth + 1);
          break;
        }
        case 'MemberExpression': {
          const property = services.esTreeNodeToTSNodeMap.get(node);
          const symbol = checker.getSymbolAtLocation(
            ts.isPropertyAccessExpression(property) ? property.name : property,
          );
          // Columnas bigint de los modelos de Prisma: importes (o recuentos) que no caben en number.
          if (declaredIn(symbol, (f) => f.includes('/src/generated/prisma/')) && isBigIntType(typeOf(node)))
            return true;
          if (declaredIn(symbol, (f) => f.includes(MONEY_DIR))) {
            const declaration = symbol.declarations?.[0];
            // Propiedades de Money/MoneyJson (no métodos): importe exacto o su texto.
            if (
              declaration &&
              (ts.isPropertySignature(declaration) ||
                ts.isPropertyDeclaration(declaration) ||
                ts.isParameter(declaration))
            ) {
              return declaration.name.getText() !== 'currency';
            }
          }
          break;
        }
        case 'Identifier': {
          if (monetaryType(typeOf(node))) return true;
          const init = localInitializer(node);
          return init ? isMonetary(init, depth + 1) : false;
        }
        default:
          break;
      }
      return monetaryType(typeOf(node));
    }

    function hasIntegerGuard(node) {
      for (let current = node.parent; current; current = current.parent) {
        if (!/Function/.test(current.type)) continue;
        const text = context.sourceCode.getText(current.body);
        if ([...GUARDS].some((g) => text.includes(`Number.${g}(`))) return true;
      }
      return false;
    }

    function comesFromParameter(node) {
      let root = node;
      while (
        root.type === 'MemberExpression' ||
        root.type === 'TSAsExpression' ||
        root.type === 'TSNonNullExpression'
      ) {
        root = root.type === 'MemberExpression' ? root.object : root.expression;
      }
      if (root.type !== 'Identifier') return true; // llamadas, elementos de arreglo…: no demostrable → se exige guarda
      let scope = context.sourceCode.getScope(root);
      while (scope) {
        const variable = scope.set.get(root.name);
        if (variable) return variable.defs.some((d) => d.type === 'Parameter');
        scope = scope.upper;
      }
      return true;
    }

    function checkNumberArgumentsToDecimal(node, args) {
      for (const arg of args) {
        if (isIntegerLiteral(arg)) continue;
        if (isNumberType(typeOf(arg))) context.report({ node: arg, messageId: 'decimalFromFloat' });
      }
    }

    function isDecimalType(type) {
      const symbol = type?.getSymbol() ?? type?.aliasSymbol;
      return symbol?.getName() === 'Decimal' && declaredIn(symbol, (f) => f.includes('/decimal.js/'));
    }

    return {
      CallExpression(node) {
        const { callee } = node;
        const args = node.arguments;
        // 1. Conversiones de un valor monetario a number.
        const conversion =
          (callee.type === 'Identifier' && NUMBER_CONVERSIONS.has(callee.name)) ||
          NUMBER_STATIC_CONVERSIONS.has(staticMember(callee, 'Number') ?? '') ||
          staticMember(callee, 'Math') !== undefined;
        if (conversion) {
          const monetary = args.find((a) => isMonetary(a));
          if (monetary) context.report({ node, messageId: 'monetaryToNumber', data: { type: typeName(monetary) } });
        }
        const method = memberName(callee);
        if (
          method &&
          !NON_AMOUNT_NUMBER_METHODS.has(method) &&
          isMonetary(callee.object) &&
          isNumberType(typeOf(node))
        ) {
          context.report({ node, messageId: 'monetaryToNumber', data: { type: typeName(callee.object) } });
        }
        // 3. BigInt(number) inexacto.
        if (callee.type === 'Identifier' && callee.name === 'BigInt' && args[0] && isNumberType(typeOf(args[0]))) {
          if (!isIntegerLiteral(args[0]) && (args[0].type === 'Literal' || !hasIntegerGuard(node))) {
            // En código monetario estricto no hay literales no enteros ni `* / % **` entre numbers: un number calculado
            // dentro del propio código solo puede ser entero. Lo que llega de fuera (un parámetro o una propiedad de un
            // parámetro) sí exige la comprobación explícita.
            if (!strict || comesFromParameter(args[0])) context.report({ node, messageId: 'unsafeBigInt' });
          }
        }
        // 4. Decimal desde number: Decimal(x)/MoneyDecimal(x) y métodos de un Decimal con argumentos number.
        const decimalReceiver =
          method !== undefined && declaredIn(typeOf(callee.object).getSymbol(), (f) => f.includes('/decimal.js/'));
        if (isDecimalType(typeOf(node)) && (callee.type === 'Identifier' || decimalReceiver)) {
          checkNumberArgumentsToDecimal(node, args);
        }
        // 5. Math en código monetario.
        const math = staticMember(callee, 'Math');
        if (strict && math && !EXACT_MATH.has(math))
          context.report({ node, messageId: 'mathInMoney', data: { name: math } });
      },
      NewExpression(node) {
        if (isDecimalType(typeOf(node))) checkNumberArgumentsToDecimal(node, node.arguments);
      },
      UnaryExpression(node) {
        if (node.operator === '+' && isMonetary(node.argument)) {
          context.report({ node, messageId: 'monetaryToNumber', data: { type: typeName(node.argument) } });
        }
      },
      'TSAsExpression, TSTypeAssertion'(node) {
        if (isMonetary(node.expression) && isLooseType(typeOf(node))) {
          context.report({
            node,
            messageId: 'monetaryAssertion',
            data: { type: typeName(node.expression), target: typeName(node) },
          });
        }
      },
      VariableDeclarator(node) {
        if (!node.init || !node.id.typeAnnotation) return;
        if (isMonetary(node.init) && isLooseType(typeOf(node.id))) {
          context.report({
            node,
            messageId: 'monetaryAssertion',
            data: { type: typeName(node.init), target: typeName(node.id) },
          });
        }
      },
      Literal(node) {
        if (strict && typeof node.value === 'number' && !Number.isInteger(node.value)) {
          context.report({ node, messageId: 'floatLiteral' });
        }
      },
      BinaryExpression(node) {
        if (!strict || !['*', '/', '%', '**'].includes(node.operator)) return;
        if (isNumberType(typeOf(node.left)) && isNumberType(typeOf(node.right))) {
          context.report({ node, messageId: 'floatArithmetic', data: { operator: node.operator } });
        }
      },
      AssignmentExpression(node) {
        if (!strict || !['*=', '/=', '%=', '**='].includes(node.operator)) return;
        if (isNumberType(typeOf(node.left))) {
          context.report({ node, messageId: 'floatArithmetic', data: { operator: node.operator } });
        }
      },
    };
  },
};
