// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'readiness_status_checks.dart';

// **************************************************************************
// BuiltValueGenerator
// **************************************************************************

class _$ReadinessStatusChecks extends ReadinessStatusChecks {
  @override
  final DependencyStatus database;

  factory _$ReadinessStatusChecks([void Function(ReadinessStatusChecksBuilder)? updates]) =>
      (ReadinessStatusChecksBuilder()..update(updates))._build();

  _$ReadinessStatusChecks._({required this.database}) : super._();
  @override
  ReadinessStatusChecks rebuild(void Function(ReadinessStatusChecksBuilder) updates) =>
      (toBuilder()..update(updates)).build();

  @override
  ReadinessStatusChecksBuilder toBuilder() => ReadinessStatusChecksBuilder()..replace(this);

  @override
  bool operator ==(Object other) {
    if (identical(other, this)) return true;
    return other is ReadinessStatusChecks && database == other.database;
  }

  @override
  int get hashCode {
    var _$hash = 0;
    _$hash = $jc(_$hash, database.hashCode);
    _$hash = $jf(_$hash);
    return _$hash;
  }

  @override
  String toString() {
    return (newBuiltValueToStringHelper(r'ReadinessStatusChecks')..add('database', database)).toString();
  }
}

class ReadinessStatusChecksBuilder implements Builder<ReadinessStatusChecks, ReadinessStatusChecksBuilder> {
  _$ReadinessStatusChecks? _$v;

  DependencyStatusBuilder? _database;
  DependencyStatusBuilder get database => _$this._database ??= DependencyStatusBuilder();
  set database(DependencyStatusBuilder? database) => _$this._database = database;

  ReadinessStatusChecksBuilder() {
    ReadinessStatusChecks._defaults(this);
  }

  ReadinessStatusChecksBuilder get _$this {
    final $v = _$v;
    if ($v != null) {
      _database = $v.database.toBuilder();
      _$v = null;
    }
    return this;
  }

  @override
  void replace(ReadinessStatusChecks other) {
    _$v = other as _$ReadinessStatusChecks;
  }

  @override
  void update(void Function(ReadinessStatusChecksBuilder)? updates) {
    if (updates != null) updates(this);
  }

  @override
  ReadinessStatusChecks build() => _build();

  _$ReadinessStatusChecks _build() {
    _$ReadinessStatusChecks _$result;
    try {
      _$result = _$v ?? _$ReadinessStatusChecks._(database: database.build());
    } catch (_) {
      late String _$failedField;
      try {
        _$failedField = 'database';
        database.build();
      } catch (e) {
        throw BuiltValueNestedFieldError(r'ReadinessStatusChecks', _$failedField, e.toString());
      }
      rethrow;
    }
    replace(_$result);
    return _$result;
  }
}

// ignore_for_file: deprecated_member_use_from_same_package,type=lint
