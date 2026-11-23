//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:api_client/src/generated/model/dependency_status.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'readiness_status_checks.g.dart';

/// ReadinessStatusChecks
///
/// Properties:
/// * [database]
@BuiltValue()
abstract class ReadinessStatusChecks implements Built<ReadinessStatusChecks, ReadinessStatusChecksBuilder> {
  @BuiltValueField(wireName: r'database')
  DependencyStatus get database;

  ReadinessStatusChecks._();

  factory ReadinessStatusChecks([void updates(ReadinessStatusChecksBuilder b)]) = _$ReadinessStatusChecks;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ReadinessStatusChecksBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ReadinessStatusChecks> get serializer => _$ReadinessStatusChecksSerializer();
}

class _$ReadinessStatusChecksSerializer implements PrimitiveSerializer<ReadinessStatusChecks> {
  @override
  final Iterable<Type> types = const [ReadinessStatusChecks, _$ReadinessStatusChecks];

  @override
  final String wireName = r'ReadinessStatusChecks';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ReadinessStatusChecks object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'database';
    yield serializers.serialize(object.database, specifiedType: const FullType(DependencyStatus));
  }

  @override
  Object serialize(
    Serializers serializers,
    ReadinessStatusChecks object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ReadinessStatusChecksBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'database':
          final valueDes =
              serializers.deserialize(value, specifiedType: const FullType(DependencyStatus)) as DependencyStatus;
          result.database.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ReadinessStatusChecks deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ReadinessStatusChecksBuilder();
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
