import 'dart:convert';

import 'package:decimal/decimal.dart';
import 'package:financial_domain/financial_domain.dart';
import 'package:test/test.dart';

/// T063 (ADR-0007): comportamiento de Money en Dart que los fixtures compartidos no cubren, con las mismas
/// interpretaciones que la versión TypeScript (`backend/test/unit/money/money.spec.ts`; research R-08, "interpretaciones a
/// confirmar"). Se ejecuta en la VM y en Chrome.
Matcher _moneyError(String code) => throwsA(isA<MoneyError>().having((e) => e.code, 'code', code));
BigInt _b(String value) => BigInt.parse(value);
Money _m(String amount, String currency) => Money.of(_b(amount), currency);

void main() {
  group('Money (T063)', () {
    test('usa BigInt para el monto, también por encima de 2^53 (incluido Flutter Web)', () {
      final m = _m('9007199254740993', 'USD');
      expect(m.amountMinor, isA<BigInt>());
      expect(m.add(_m('2', 'USD')).amountMinor.toString(), '9007199254740995');
      expect(_m('9223372036854775807', 'USD').subtract(_m('1', 'USD')).amountMinor.toString(), '9223372036854775806');
    });

    test('of valida primero la moneda y después el dominio; el dominio es simétrico', () {
      expect(() => Money.of(BigInt.two.pow(63), 'ZZZ'), _moneyError('UNSUPPORTED_CURRENCY'));
      expect(() => Money.of(-BigInt.two.pow(63), 'MXN'), _moneyError('AMOUNT_OUT_OF_RANGE'));
      expect(Money.of(-(BigInt.two.pow(63) - BigInt.one), 'MXN').amountMinor, moneyMinMinor);
      expect(Money.zero('JPY'), Money.of(BigInt.zero, 'JPY'));
      expect(_m('1', 'MXN') == _m('1', 'USD'), isFalse);
      expect(_m('1', 'MXN').equals(_m('1', 'MXN')), isTrue);
      expect(_m('1', 'MXN').hashCode, _m('1', 'MXN').hashCode);
    });

    test('desbordamiento en add, subtract y multiply → AMOUNT_OUT_OF_RANGE, sin truncar ni saturar', () {
      final max = Money.of(moneyMaxMinor, 'MXN');
      final min = Money.of(moneyMinMinor, 'MXN');
      expect(() => max.add(_m('1', 'MXN')), _moneyError('AMOUNT_OUT_OF_RANGE'));
      expect(() => min.subtract(_m('1', 'MXN')), _moneyError('AMOUNT_OUT_OF_RANGE'));
      expect(() => max.multiply(Decimal.parse('2')), _moneyError('AMOUNT_OUT_OF_RANGE'));
    });

    test('monedas distintas → CURRENCY_MISMATCH', () {
      expect(() => _m('1', 'MXN').add(_m('1', 'USD')), _moneyError('CURRENCY_MISMATCH'));
      expect(() => _m('1', 'MXN').subtract(_m('1', 'USD')), _moneyError('CURRENCY_MISMATCH'));
    });

    test('toJson usa la forma del contrato con amount_minor como String', () {
      expect(
        jsonEncode({'x': _m('-9007199254740993', 'USD')}),
        '{"x":{"amount_minor":"-9007199254740993","currency":"USD"}}',
      );
    });

    test('multiply usa el valor exacto del factor, también con notación exponencial', () {
      expect(_m('10000000', 'MXN').multiply(Decimal.parse('1e-7')).amountMinor, BigInt.one);
      expect(_m('3', 'MXN').multiply(Decimal.parse('2E+3')).amountMinor, _b('6000'));
      expect(_m('3', 'MXN').multiply(Decimal.parse('-0.5'), RoundingMode.halfEven).amountMinor, _b('-2'));
      expect(() => _m('1', 'MXN').multiply(Decimal.parse('0.5')), _moneyError('ROUNDING_REQUIRED'));
    });

    test('multiply rechaza factores extremos como error de programación (RangeError), no de dominio', () {
      expect(() => _m('1', 'MXN').multiply(Decimal.parse('1e5000')), throwsRangeError);
      expect(() => _m('1', 'MXN').multiply(Decimal.parse('1e-5000')), throwsRangeError);
    });

    test('allocate: total negativo se reparte de forma simétrica (misma interpretación que TypeScript)', () {
      expect([for (final m in _m('-100', 'MXN').allocate(3)) m.amountMinor.toString()], ['-34', '-33', '-33']);
      expect(
        [
          for (final m in _m('-5', 'MXN').allocateRatios([1, 1])) m.amountMinor.toString(),
        ],
        ['-3', '-2'],
      );
    });

    test('allocate rechaza argumentos inválidos (errores de programación)', () {
      final m = _m('10', 'MXN');
      for (final bad in [0, -1]) {
        expect(() => m.allocate(bad), throwsRangeError, reason: '$bad');
      }
      for (final bad in [
        <int>[],
        [0, 0],
        [1, -1],
      ]) {
        expect(() => m.allocateRatios(bad), throwsArgumentError, reason: '$bad');
      }
    });

    test('parse: interpretaciones estrictas no cubiertas por los fixtures compartidos', () {
      for (final text in ['007.5', '-0', '-0.00', '.5', '1.', '١٢٣', '0x10', '1_000', '+1', ' 1', '1e3']) {
        expect(() => Money.parse(text, 'MXN'), _moneyError('INVALID_AMOUNT'), reason: text);
      }
      expect(() => Money.parse('1' * 40, 'JPY'), _moneyError('AMOUNT_OUT_OF_RANGE'));
      expect(() => Money.parse('1', 'mxn'), _moneyError('UNSUPPORTED_CURRENCY'));
      expect(Money.parse('0.50', 'MXN').amountMinor, _b('50'));
    });

    test('divideRounded exige divisor positivo y respeta los modos', () {
      expect(() => divideRounded(BigInt.one, BigInt.zero), throwsRangeError);
      expect(divideRounded(_b('10'), _b('5')), BigInt.two);
      expect(() => divideRounded(BigInt.one, _b('3')), _moneyError('ROUNDING_REQUIRED'));
      expect(divideRounded(_b('-7'), BigInt.two, RoundingMode.floor), _b('-4'));
      expect(divideRounded(_b('7'), BigInt.two, RoundingMode.ceiling), _b('4'));
      expect(RoundingMode.fromCode('HALF_EVEN'), RoundingMode.halfEven);
      expect(() => RoundingMode.fromCode('HALF_DOWN'), throwsArgumentError);
    });

    test('catálogo cerrado', () {
      expect(isCurrencyCode('MXN'), isTrue);
      for (final bad in ['mxn', 'EUR', '', 'constructor', 'toString', '__proto__', null, 1]) {
        expect(isCurrencyCode(bad), isFalse, reason: '$bad');
      }
      expect(() => requireCurrency('__proto__'), _moneyError('UNSUPPORTED_CURRENCY'));
      expect(minorUnits('CLF'), 4);
    });

    test('los códigos de error coinciden con los de TypeScript y los mensajes nunca incluyen el valor', () {
      expect(
        [for (final c in MoneyErrorCode.values) c.code],
        [
          'CURRENCY_MISMATCH',
          'ROUNDING_REQUIRED',
          'INVALID_AMOUNT',
          'TOO_MANY_DECIMALS',
          'AMOUNT_OUT_OF_RANGE',
          'UNSUPPORTED_CURRENCY',
        ],
      );
      try {
        Money.parse('12345.678', 'MXN');
        fail('se esperaba MoneyError');
      } on MoneyError catch (error) {
        expect(error.toString(), isNot(contains('12345')));
      }
    });
  });

  group('JSON en la frontera (from_json)', () {
    test('rechaza estructuras que no son objeto y montos que no son String', () {
      for (final bad in <Object?>[
        null,
        'x',
        1,
        <Object?>[],
        {'amount_minor': 100, 'currency': 'MXN'},
        {'currency': 'MXN'},
      ]) {
        expect(() => Money.fromJson(bad), _moneyError('INVALID_AMOUNT'), reason: '$bad');
      }
      expect(() => Money.fromJson({'amount_minor': '1'}), _moneyError('UNSUPPORTED_CURRENCY'));
    });
  });
}
