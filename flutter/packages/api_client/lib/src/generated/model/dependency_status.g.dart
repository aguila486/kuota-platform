// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'dependency_status.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const DependencyStatusStatusEnum _$dependencyStatusStatusEnum_up = const DependencyStatusStatusEnum._('up');
const DependencyStatusStatusEnum _$dependencyStatusStatusEnum_down = const DependencyStatusStatusEnum._('down');

DependencyStatusStatusEnum _$dependencyStatusStatusEnumValueOf(String name) {
  switch (name) {
    case 'up':
      return _$dependencyStatusStatusEnum_up;
    case 'down':
      return _$dependencyStatusStatusEnum_down;
    default:
      throw ArgumentError(name);
  }
}

final BuiltSet<DependencyStatusStatusEnum> _$dependencyStatusStatusEnumValues = BuiltSet<DependencyStatusStatusEnum>(
  const <DependencyStatusStatusEnum>[_$dependencyStatusStatusEnum_up, _$dependencyStatusStatusEnum_down],
);

Serializer<DependencyStatusStatusEnum> _$dependencyStatusStatusEnumSerializer =
    _$DependencyStatusStatusEnumSerializer();

class _$DependencyStatusStatusEnumSerializer implements PrimitiveSerializer<DependencyStatusStatusEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{'up': 'up', 'down': 'down'};
  static const Map<Object, String> _fromWire = const <Object, String>{'up': 'up', 'down': 'down'};

  @override
  final Iterable<Type> types = const <Type>[DependencyStatusStatusEnum];
  @override
  final String wireName = 'DependencyStatusStatusEnum';

  @override
  Object serialize(
    Serializers serializers,
    DependencyStatusStatusEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  DependencyStatusStatusEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => DependencyStatusStatusEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$DependencyStatus extends DependencyStatus {
  @override
  final DependencyStatusStatusEnum status;

  factory _$DependencyStatus([void Function(DependencyStatusBuilder)? updates]) =>
      (DependencyStatusBuilder()..update(updates))._build();

  _$DependencyStatus._({required this.status}) : super._();
  @override
  DependencyStatus rebuild(void Function(DependencyStatusBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  DependencyStatusBuilder toBuilder() => DependencyStatusBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is DependencyStatus && status == other.status;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, status.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'DependencyStatus')..add('status', status)).toString();
  }
}

class DependencyStatusBuilder implements Builder<DependencyStatus, DependencyStatusBuilder> {
  _$DependencyStatus? _$v;

  DependencyStatusStatusEnum? _status;
  DependencyStatusStatusEnum? get status => _$this._status;
  set status(DependencyStatusStatusEnum? status) => _$this._status = status;

  DependencyStatusBuilder() {
    DependencyStatus._defaults(this);
  }

  DependencyStatusBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _status = $v.status;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(DependencyStatus other) {
    _$v = other as _$DependencyStatus;
  }

  @override
  void update(void Function(DependencyStatusBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  DependencyStatus build() => _build();

  _$DependencyStatus _build() {
    final _$result =
        _$v ??
        _$DependencyStatus._(status: BuiltValueNullFieldError.checkNotNull(status, r'DependencyStatus', 'status'));
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
