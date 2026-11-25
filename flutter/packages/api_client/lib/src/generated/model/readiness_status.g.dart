// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'readiness_status.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const ReadinessStatusStatusEnum _$readinessStatusStatusEnum_ok = const ReadinessStatusStatusEnum._('ok');
const ReadinessStatusStatusEnum _$readinessStatusStatusEnum_error = const ReadinessStatusStatusEnum._('error');

ReadinessStatusStatusEnum _$readinessStatusStatusEnumValueOf(String name) {
  switch (name) {
    case 'ok':
      return _$readinessStatusStatusEnum_ok;
    case 'error':
      return _$readinessStatusStatusEnum_error;
    default:
      throw ArgumentError(name);
  }
}

final BuiltSet<ReadinessStatusStatusEnum> _$readinessStatusStatusEnumValues = BuiltSet<ReadinessStatusStatusEnum>(
  const <ReadinessStatusStatusEnum>[_$readinessStatusStatusEnum_ok, _$readinessStatusStatusEnum_error],
);

Serializer<ReadinessStatusStatusEnum> _$readinessStatusStatusEnumSerializer = _$ReadinessStatusStatusEnumSerializer();

class _$ReadinessStatusStatusEnumSerializer implements PrimitiveSerializer<ReadinessStatusStatusEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{'ok': 'ok', 'error': 'error'};
  static const Map<Object, String> _fromWire = const <Object, String>{'ok': 'ok', 'error': 'error'};

  @override
  final Iterable<Type> types = const <Type>[ReadinessStatusStatusEnum];
  @override
  final String wireName = 'ReadinessStatusStatusEnum';

  @override
  Object serialize(
    Serializers serializers,
    ReadinessStatusStatusEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  ReadinessStatusStatusEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => ReadinessStatusStatusEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$ReadinessStatus extends ReadinessStatus {
  @override
  final ReadinessStatusStatusEnum status;
  @override
  final ReadinessStatusChecks checks;

  factory _$ReadinessStatus([void Function(ReadinessStatusBuilder)? updates]) =>
      (ReadinessStatusBuilder()..update(updates))._build();

  _$ReadinessStatus._({required this.status, required this.checks}) : super._();
  @override
  ReadinessStatus rebuild(void Function(ReadinessStatusBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  ReadinessStatusBuilder toBuilder() => ReadinessStatusBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ReadinessStatus && status == other.status && checks == other.checks;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, status.hashCode);
    _$hash = $jc(_$hash, checks.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ReadinessStatus')
          ..add('status', status)
          ..add('checks', checks))
        .toString();
  }
}

class ReadinessStatusBuilder implements Builder<ReadinessStatus, ReadinessStatusBuilder> {
  _$ReadinessStatus? _$v;

  ReadinessStatusStatusEnum? _status;
  ReadinessStatusStatusEnum? get status => _$this._status;
  set status(ReadinessStatusStatusEnum? status) => _$this._status = status;

  ReadinessStatusChecksBuilder? _checks;
  ReadinessStatusChecksBuilder get checks => _$this._checks ??= ReadinessStatusChecksBuilder();
  set checks(ReadinessStatusChecksBuilder? checks) => _$this._checks = checks;

  ReadinessStatusBuilder() {
    ReadinessStatus._defaults(this);
  }

  ReadinessStatusBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _status = $v.status;
      _checks = $v.checks.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ReadinessStatus other) {
    _$v = other as _$ReadinessStatus;
  }

  @override
  void update(void Function(ReadinessStatusBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ReadinessStatus build() => _build();

  _$ReadinessStatus _build() {
    _$ReadinessStatus _$result;
    try {
      _$result =
          _$v ??
          _$ReadinessStatus._(
            status: BuiltValueNullFieldError.checkNotNull(status, r'ReadinessStatus', 'status'),
            checks: checks.build(),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'checks';
        checks.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ReadinessStatus', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
