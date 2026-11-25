import 'package:shared_core/shared_core.dart';
import 'package:test/test.dart';

/// T081: `Result`/`Failure`.
void main() {
  const failure = Failure('compatibility-unavailable', message: 'servicio no disponible');

  test('Ok y Err se distinguen y el switch es exhaustivo (sealed)', () {
    String describe(Result<int> result) => switch (result) {
      Ok(:final value) => 'ok $value',
      Err(:final failure) => 'err ${failure.code}',
    };
    expect(describe(const Ok(3)), 'ok 3');
    expect(describe(const Err(failure)), 'err compatibility-unavailable');
    expect(const Ok(3).isOk, isTrue);
    expect(const Err<int>(failure).isOk, isFalse);
  });

  test('map transforma un Ok y propaga un Err sin cambios', () {
    expect(const Ok(2).map((v) => v * 10), const Ok(20));
    expect(const Err<int>(failure).map((v) => v * 10), const Err<int>(failure));
  });

  test('fold reduce ambos casos', () {
    expect(const Ok('x').fold(ok: (v) => v.length, err: (_) => -1), 1);
    expect(const Err<String>(failure).fold(ok: (v) => v.length, err: (f) => f.code.length), 25);
  });

  test('igualdad por valor', () {
    expect(const Failure('a', message: 'm'), const Failure('a', message: 'm'));
    expect(const Failure('a'), isNot(const Failure('b')));
    expect(const Failure('a').hashCode, const Failure('a').hashCode);
    expect(const Ok(1).toString(), 'Ok(1)');
    expect(const Err<int>(Failure('a')).toString(), 'Err(Failure(a))');
    expect(failure.toString(), 'Failure(compatibility-unavailable: servicio no disponible)');
  });
}
