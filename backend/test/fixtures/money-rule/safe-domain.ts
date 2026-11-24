// T104: usos LEGÍTIMOS de number en código monetario estricto. La regla no debe producir ningún error.
import { Decimal } from 'decimal.js';
import { Money, MoneyDecimal, minorUnits, moneyFromJson } from '../../../src/common/money/index.js';

export const CONFIG = Decimal.clone({ precision: 40, toExpNeg: -9e15, toExpPos: 9e15 }); // exponentes enteros
type Fila = readonly [string, number];
export type Indice = Fila[number]; // tipo de índice

export function legitimos(money: Money, items: readonly Money[], version: number, pagina: number): unknown[] {
  const r: unknown[] = [];
  for (let i = 0; i < items.length; i += 1) r.push(items[i]); // índice y contador
  r.push(version + 1, pagina - 1); // versiones y tamaños de página
  const escala = minorUnits(money.currency); // escala monetaria
  r.push(10n ** BigInt(escala)); // escala calculada internamente (sin literales ni aritmética flotante)
  r.push(money.allocate([1, 2, 3]), money.allocate(4)); // pesos y partes de allocate
  r.push(Math.max(version, 1), Math.min(pagina, 100), Math.abs(version)); // exactos sobre enteros
  r.push(BigInt(7), BigInt('9223372036854775807')); // literal entero y string canónico
  r.push(new Decimal('0.15'), MoneyDecimal('1.25'), new Decimal(3)); // Decimal desde string o entero
  r.push(money.multiply(new Decimal('1.16'), 'HALF_EVEN')); // Money con factor exacto
  r.push(new Decimal('1.5').comparedTo(new Decimal('2')), new Decimal('1.25').decimalPlaces()); // no son importes
  r.push(moneyFromJson({ amount_minor: '150000', currency: 'MXN' }).amountMinor.toString()); // texto exacto
  r.push(money.format(), money.amountMinor + 1n, money.amountMinor * 2n); // aritmética bigint
  r.push(Number.parseInt('12', 10)); // entero que no es un importe
  return r;
}

export function pesos(ratios: readonly number[]): bigint[] {
  if (ratios.some((x) => !Number.isSafeInteger(x))) throw new RangeError('enteros');
  return ratios.map((x) => BigInt(x)); // con comprobación de entero seguro
}
