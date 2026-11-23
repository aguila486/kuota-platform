/** Primitiva monetaria compartida (ADR-0007; T061, T062). Única representación de dinero del backend. */
export { CURRENCIES, type CurrencyCode, isCurrencyCode, minorUnits, requireCurrency } from './currencies.js';
export { Money, MoneyDecimal, MONEY_MAX_MINOR, MONEY_MIN_MINOR } from './money.js';
export { MONEY_ERROR_CODES, MoneyError, type MoneyErrorCode } from './money-error.js';
export { CANONICAL_AMOUNT_MINOR, type MoneyJson, moneyFromJson, moneyToJson, parseMoneyField } from './money.json.js';
export { divideRounded, ROUNDING_MODES, type RoundingMode } from './rounding.js';
