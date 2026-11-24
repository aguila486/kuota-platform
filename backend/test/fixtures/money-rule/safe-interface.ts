// T104: usos LEGÍTIMOS en una capa de interfaz y fuera del dinero. La regla no debe producir ningún error.
import { type Money, type MoneyJson, moneyToJson, parseMoneyField } from '../../../src/common/money/index.js';

export function http(body: Record<string, unknown>, money: Money, limitRaw: string): unknown[] {
  const r: unknown[] = [];
  r.push(parseMoneyField(body['sample_amount'], 'sample_amount')); // frontera validada (string canónico)
  const json: MoneyJson = moneyToJson(money);
  r.push(json.amount_minor, json.currency, JSON.stringify(json)); // representación exacta
  r.push(Number.parseInt(limitRaw, 10), Number(body['version'] === 1)); // límites y versiones
  r.push(Number(json.currency.length)); // longitud de la moneda: no es un importe
  r.push(BigInt(json.amount_minor)); // string canónico → bigint exacto
  return r;
}
