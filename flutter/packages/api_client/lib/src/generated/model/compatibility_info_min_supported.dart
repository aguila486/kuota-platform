//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'compatibility_info_min_supported.g.dart';

/// CompatibilityInfoMinSupported
///
/// Properties:
/// * [admin]
/// * [collector]
/// * [client]
@BuiltValue()
abstract class CompatibilityInfoMinSupported
    implements Built<CompatibilityInfoMinSupported, CompatibilityInfoMinSupportedBuilder> {
  @BuiltValueField(wireName: r'admin')
  String get admin;

  @BuiltValueField(wireName: r'collector')
  String get collector;

  @BuiltValueField(wireName: r'client')
  String get client;

  CompatibilityInfoMinSupported._();

  factory CompatibilityInfoMinSupported([void updates(CompatibilityInfoMinSupportedBuilder b)]) =
      _$CompatibilityInfoMinSupported;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(CompatibilityInfoMinSupportedBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<CompatibilityInfoMinSupported> get serializer => _$CompatibilityInfoMinSupportedSerializer();
}

class _$CompatibilityInfoMinSupportedSerializer implements PrimitiveSerializer<CompatibilityInfoMinSupported> {
  @override
  final Iterable<Type> types = const [CompatibilityInfoMinSupported, _$CompatibilityInfoMinSupported];

  @override
  final String wireName = r'CompatibilityInfoMinSupported';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    CompatibilityInfoMinSupported object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'admin';
    yield serializers.serialize(object.admin, specifiedType: const FullType(String));
    yield r'collector';
    yield serializers.serialize(object.collector, specifiedType: const FullType(String));
    yield r'client';
    yield serializers.serialize(object.client, specifiedType: const FullType(String));
  }

  @override
  Object serialize(
    Serializers serializers,
    CompatibilityInfoMinSupported object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required CompatibilityInfoMinSupportedBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'admin':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.admin = valueDes;
          break;
        case r'collector':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.collector = valueDes;
          break;
        case r'client':
          final valueDes = serializers.deserialize(value, specifiedType: const FullType(String)) as String;
          result.client = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  CompatibilityInfoMinSupported deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = CompatibilityInfoMinSupportedBuilder();
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
