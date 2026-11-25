// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'liveness_status.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

const LivenessStatusStatusEnum _$livenessStatusStatusEnum_ok = const LivenessStatusStatusEnum._('ok');

LivenessStatusStatusEnum _$livenessStatusStatusEnumValueOf(String name) {
  switch (name) {
    case 'ok':
      return _$livenessStatusStatusEnum_ok;
    default:
      throw ArgumentError(name);
  }
}

final BuiltSet<LivenessStatusStatusEnum> _$livenessStatusStatusEnumValues = BuiltSet<LivenessStatusStatusEnum>(
  const <LivenessStatusStatusEnum>[_$livenessStatusStatusEnum_ok],
);

Serializer<LivenessStatusStatusEnum> _$livenessStatusStatusEnumSerializer = _$LivenessStatusStatusEnumSerializer();

class _$LivenessStatusStatusEnumSerializer implements PrimitiveSerializer<LivenessStatusStatusEnum> {
  static const Map<String, Object> _toWire = const <String, Object>{'ok': 'ok'};
  static const Map<Object, String> _fromWire = const <Object, String>{'ok': 'ok'};

  @override
  final Iterable<Type> types = const <Type>[LivenessStatusStatusEnum];
  @override
  final String wireName = 'LivenessStatusStatusEnum';

  @override
  Object serialize(
    Serializers serializers,
    LivenessStatusStatusEnum object, {
    FullType specifiedType = FullType.unspecified,
  }) => _toWire[object.name] ?? object.name;

  @override
  LivenessStatusStatusEnum deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) => LivenessStatusStatusEnum.valueOf(_fromWire[serialized] ?? (serialized is String ? serialized : ''));
}

class _$LivenessStatus extends LivenessStatus {
  @override
  final LivenessStatusStatusEnum status;

  factory _$LivenessStatus([void Function(LivenessStatusBuilder)? updates]) =>
      (LivenessStatusBuilder()..update(updates))._build();

  _$LivenessStatus._({required this.status}) : super._();
  @override
  LivenessStatus rebuild(void Function(LivenessStatusBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  LivenessStatusBuilder toBuilder() => LivenessStatusBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is LivenessStatus && status == other.status;
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
    return (newBuiltValueToStringHelper(r'LivenessStatus')..add('status', status)).toString();
  }
}

class LivenessStatusBuilder implements Builder<LivenessStatus, LivenessStatusBuilder> {
  _$LivenessStatus? _$v;

  LivenessStatusStatusEnum? _status;
  LivenessStatusStatusEnum? get status => _$this._status;
  set status(LivenessStatusStatusEnum? status) => _$this._status = status;

  LivenessStatusBuilder() {
    LivenessStatus._defaults(this);
  }

  LivenessStatusBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _status = $v.status;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(LivenessStatus other) {
    _$v = other as _$LivenessStatus;
  }

  @override
  void update(void Function(LivenessStatusBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  LivenessStatus build() => _build();

  _$LivenessStatus _build() {
    final _$result =
        _$v ?? _$LivenessStatus._(status: BuiltValueNullFieldError.checkNotNull(status, r'LivenessStatus', 'status'));
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
