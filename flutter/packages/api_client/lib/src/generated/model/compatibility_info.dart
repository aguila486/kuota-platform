//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:api_client/src/generated/model/compatibility_info_min_supported.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'compatibility_info.g.dart';

/// CompatibilityInfo
///
/// Properties:
/// * [apiVersion]
/// * [minSupported]
/// * [clientSupported] - Si se envió `X-App-Version`, indica si esa versión está soportada.
/// * [serverTime]
@BuiltValue()
abstract class CompatibilityInfo implements Built<CompatibilityInfo, CompatibilityInfoBuilder> {
  @BuiltValueField(wireName: r'api_version')
  String get apiVersion;

  @BuiltValueField(wireName: r'min_supported')
  CompatibilityInfoMinSupported get minSupported;

  /// Si se envió `X-App-Version`, indica si esa versión está soportada.
  @BuiltValueField(wireName: r'client_supported')
  bool? get clientSupported;

  @BuiltValueField(wireName: r'server_time')
  DateTime get serverTime;

  CompatibilityInfo._();

  factory CompatibilityInfo([void updates(CompatibilityInfoBuilder b)]) = _$CompatibilityInfo;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(CompatibilityInfoBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<CompatibilityInfo> get serializer => _$CompatibilityInfoSerializer();
}

class _$CompatibilityInfoSerializer implements PrimitiveSerializer<CompatibilityInfo> {
  @override
  final Iterable<Type> types = const [CompatibilityInfo, _$CompatibilityInfo];

  @override
  final String wireName = r'CompatibilityInfo';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    CompatibilityInfo object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'api_version';
    yield serializers.serialize(object.apiVersion, specifiedType: const FullType(String));
    yield r'min_supported';
    yield serializers.serialize(object.minSupported, specifiedType: const FullType(CompatibilityInfoMinSupported));
    if (object.clientSupported != null) {
      yield r'client_supported';
      yield serializers.serialize(object.clientSupported, specifiedType: const FullType.nullable(bool));
    }
    yield r'server_time';
    yield serializers.serialize(object.serverTime, specifiedType: const FullType(DateTime));
  }

  @override
  Object serialize(Serializers serializers, CompatibilityInfo object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required CompatibilityInfoBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'api_version':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.apiVersion = valueDes;
          break;
        case r'min_supported':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(CompatibilityInfoMinSupported),
          ) as CompatibilityInfoMinSupported;
          result.minSupported.replace(valueDes);
          break;
        case r'client_supported':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType.nullable(bool)) as bool?;
          if (valueDes == null) continue;
          result.clientSupported = valueDes;
          break;
        case r'server_time':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(DateTime)) as DateTime;
          result.serverTime = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  CompatibilityInfo deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = CompatibilityInfoBuilder();
    final serializedList = (serialized as Iterable<Object?>).toList();
    final unhandled = <Object?>[];
    _deserializeProperties(
      serializers,
      serialized,
      specifiedType: specifiedType,
      serializedList: serializedList,
      unhandled: unhandled,
      result: result,
    );
    return result.build();
  }
}
