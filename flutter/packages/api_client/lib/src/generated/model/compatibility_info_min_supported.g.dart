// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'compatibility_info_min_supported.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$CompatibilityInfoMinSupported extends CompatibilityInfoMinSupported {
  @override
  final String admin;
  @override
  final String collector;
  @override
  final String client;

  factory _$CompatibilityInfoMinSupported([void Function(CompatibilityInfoMinSupportedBuilder)? updates]) =>
      (CompatibilityInfoMinSupportedBuilder()..update(updates))._build();

  _$CompatibilityInfoMinSupported._({required this.admin, required this.collector, required this.client}) : super._();
  @override
  CompatibilityInfoMinSupported rebuild(void Function(CompatibilityInfoMinSupportedBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  CompatibilityInfoMinSupportedBuilder toBuilder() => CompatibilityInfoMinSupportedBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is CompatibilityInfoMinSupported &&
        admin == other.admin &&
        collector == other.collector &&
        client == other.client;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, admin.hashCode);
    _$hash = $jc(_$hash, collector.hashCode);
    _$hash = $jc(_$hash, client.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'CompatibilityInfoMinSupported')
          ..add('admin', admin)
          ..add('collector', collector)
          ..add('client', client))
        .toString();
  }
}

class CompatibilityInfoMinSupportedBuilder
    implements Builder<CompatibilityInfoMinSupported, CompatibilityInfoMinSupportedBuilder> {
  _$CompatibilityInfoMinSupported? _$v;

  String? _admin;
  String? get admin => _$this._admin;
  set admin(String? admin) => _$this._admin = admin;

  String? _collector;
  String? get collector => _$this._collector;
  set collector(String? collector) => _$this._collector = collector;

  String? _client;
  String? get client => _$this._client;
  set client(String? client) => _$this._client = client;

  CompatibilityInfoMinSupportedBuilder() {
    CompatibilityInfoMinSupported._defaults(this);
  }

  CompatibilityInfoMinSupportedBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _admin = $v.admin;
      _collector = $v.collector;
      _client = $v.client;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(CompatibilityInfoMinSupported other) {
    _$v = other as _$CompatibilityInfoMinSupported;
  }

  @override
  void update(void Function(CompatibilityInfoMinSupportedBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  CompatibilityInfoMinSupported build() => _build();

  _$CompatibilityInfoMinSupported _build() {
    final _$result =
        _$v ??
        _$CompatibilityInfoMinSupported._(
          admin: BuiltValueNullFieldError.checkNotNull(admin, r'CompatibilityInfoMinSupported', 'admin'),
          collector: BuiltValueNullFieldError.checkNotNull(collector, r'CompatibilityInfoMinSupported', 'collector'),
          client: BuiltValueNullFieldError.checkNotNull(client, r'CompatibilityInfoMinSupported', 'client'),
        );
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
