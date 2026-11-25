// T104: casos INSEGUROS en una capa de interfaz (regla tipada sin aritmética estricta). Cada línea marcada con
// `✗ <messageId>` debe producir exactamente ese error; ninguna otra línea debe producir errores de la regla.
import { Decimal } from 'decimal.js';
import { type Money, type MoneyJson, MoneyDecimal } from '../../../src/common/money/index.js';

type Importe = Money; // alias
interface PagoDto {
  readonly monto: MoneyJson;
  readonly tasa: Decimal;
}

export function casos(money: Money, json: MoneyJson, dto: PagoDto, importe: Importe, cuerpo: unknown): unknown[] {
  const texto = money.amountMinor.toString(); // inferido: texto de un importe
  const enMinimos = json.amount_minor;
  const r: unknown[] = [];
  r.push(parseFloat(json.amount_minor)); // ✗ monetaryToNumber
  r.push(Number(money.amountMinor)); // ✗ monetaryToNumber
  r.push(Number.parseFloat(texto)); // ✗ monetaryToNumber
  r.push(parseInt(enMinimos, 10)); // ✗ monetaryToNumber
  r.push(dto.tasa.toNumber()); // ✗ monetaryToNumber
  r.push(new Decimal('1.25').toNumber()); // ✗ monetaryToNumber
  r.push(+dto.monto.amount_minor); // ✗ monetaryToNumber
  r.push(Number(`${importe.amountMinor}`)); // ✗ monetaryToNumber
  r.push(Math.round(Number(String(money.amountMinor)))); // ✗ monetaryToNumber (la conversión interior)
  r.push(money.amountMinor as unknown as number); // ✗ monetaryAssertion ✗ monetaryAssertion (ambas aserciones)
  r.push((importe as unknown as { amountMinor: number }).amountMinor); // ✗ monetaryAssertion
  const oculto: number = Number(json.amount_minor); // ✗ monetaryToNumber
  const comoAny: unknown = money.amountMinor; // ✗ monetaryAssertion
  r.push(oculto, comoAny);
  if (typeof cuerpo === 'number') r.push(BigInt(cuerpo)); // ✗ unsafeBigInt
  r.push(BigInt(1.5)); // ✗ unsafeBigInt
  const parsed = JSON.parse('{"amount":1.5}') as { amount: number };
  r.push(BigInt(parsed.amount)); // ✗ unsafeBigInt
  r.push(new Decimal(0.1)); // ✗ decimalFromFloat
  r.push(MoneyDecimal(parsed.amount)); // ✗ decimalFromFloat
  r.push(dto.tasa.times(0.15)); // ✗ decimalFromFloat
  return r;
}
