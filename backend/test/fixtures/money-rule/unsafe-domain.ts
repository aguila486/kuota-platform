// T104: casos INSEGUROS en código monetario estricto (src/common/money, domain/): aritmética y Math sobre numbers.
import { Money } from '../../../src/common/money/index.js';

export function calculos(precio: number, cantidad: number, minimos: bigint): unknown[] {
  const r: unknown[] = [];
  r.push(precio * cantidad); // ✗ floatArithmetic
  r.push(precio / 3); // ✗ floatArithmetic
  r.push(precio ** 2); // ✗ floatArithmetic
  r.push(precio % 7); // ✗ floatArithmetic
  r.push(0.1 + 0.2); // ✗ floatLiteral ✗ floatLiteral
  r.push(Math.round(precio)); // ✗ mathInMoney
  r.push(Math.floor(precio)); // ✗ mathInMoney
  r.push(Money.of(BigInt(precio), 'MXN')); // ✗ unsafeBigInt
  r.push(Number(minimos)); // ✗ monetaryToNumber
  let acumulado = precio;
  acumulado *= 1; // ✗ floatArithmetic
  r.push(acumulado);
  return r;
}
