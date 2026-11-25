// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'compatibility_info.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$CompatibilityInfo extends CompatibilityInfo {
  @override
  final String apiVersion;
  @override
  final CompatibilityInfoMinSupported minSupported;
  @override
  final bool? clientSupported;
  @override
  final DateTime serverTime;

  factory _$CompatibilityInfo([void Function(CompatibilityInfoBuilder)? updates]) =>
      (CompatibilityInfoBuilder()..update(updates))._build();

  _$CompatibilityInfo._({
    required this.apiVersion,
    required this.minSupported,
    this.clientSupported,
    required this.serverTime,
  }) : super._();
  @override
  CompatibilityInfo rebuild(void Function(CompatibilityInfoBuilder) updates) => (toBuilder()..update(updates)).build();

  @override
  CompatibilityInfoBuilder toBuilder() => CompatibilityInfoBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is CompatibilityInfo &&
        apiVersion == other.apiVersion &&
        minSupported == other.minSupported &&
        clientSupported == other.clientSupported &&
        serverTime == other.serverTime;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, apiVersion.hashCode);
    _$hash = $jc(_$hash, minSupported.hashCode);
    _$hash = $jc(_$hash, clientSupported.hashCode);
    _$hash = $jc(_$hash, serverTime.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'CompatibilityInfo')
          ..add('apiVersion', apiVersion)
          ..add('minSupported', minSupported)
          ..add('clientSupported', clientSupported)
          ..add('serverTime', serverTime))
        .toString();
  }
}

class CompatibilityInfoBuilder implements Builder<CompatibilityInfo, CompatibilityInfoBuilder> {
  _$CompatibilityInfo? _$v;

  String? _apiVersion;
  String? get apiVersion => _$this._apiVersion;
  set apiVersion(String? apiVersion) => _$this._apiVersion = apiVersion;

  CompatibilityInfoMinSupportedBuilder? _minSupported;
  CompatibilityInfoMinSupportedBuilder get minSupported =>
      _$this._minSupported ??= CompatibilityInfoMinSupportedBuilder();
  set minSupported(CompatibilityInfoMinSupportedBuilder? minSupported) => _$this._minSupported = minSupported;

  bool? _clientSupported;
  bool? get clientSupported => _$this._clientSupported;
  set clientSupported(bool? clientSupported) => _$this._clientSupported = clientSupported;

  DateTime? _serverTime;
  DateTime? get serverTime => _$this._serverTime;
  set serverTime(DateTime? serverTime) => _$this._serverTime = serverTime;

  CompatibilityInfoBuilder() {
    CompatibilityInfo._defaults(this);
  }

  CompatibilityInfoBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _apiVersion = $v.apiVersion;
      _minSupported = $v.minSupported.toBuilder();
      _clientSupported = $v.clientSupported;
      _serverTime = $v.serverTime;
      _$v = null;
    }
    return this;
  }

  @override
  void replace(CompatibilityInfo other) {
    _$v = other as _$CompatibilityInfo;
  }

  @override
  void update(void Function(CompatibilityInfoBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  CompatibilityInfo build() => _build();

  _$CompatibilityInfo _build() {
    _$CompatibilityInfo _$result;
    try {
      _$result =
          _$v ??
          _$CompatibilityInfo._(
            apiVersion: BuiltValueNullFieldError.checkNotNull(apiVersion, r'CompatibilityInfo', 'apiVersion'),
            minSupported: minSupported.build(),
            clientSupported: clientSupported,
            serverTime: BuiltValueNullFieldError.checkNotNull(serverTime, r'CompatibilityInfo', 'serverTime'),
          );
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'minSupported';
        minSupported.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'CompatibilityInfo', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
