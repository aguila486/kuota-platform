//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:api_client/src/generated/model/readiness_status_checks.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'readiness_status.g.dart';

/// ReadinessStatus
///
/// Properties:
/// * [status]
/// * [checks]
@BuiltValue()
abstract class ReadinessStatus implements Built<ReadinessStatus, ReadinessStatusBuilder> {
  @BuiltValueField(wireName: r'status')
  ReadinessStatusStatusEnum get status;
  // enum statusEnum {  ok,  error,  };

  @BuiltValueField(wireName: r'checks')
  ReadinessStatusChecks get checks;

  ReadinessStatus._();

  factory ReadinessStatus([void updates(ReadinessStatusBuilder b)]) = _$ReadinessStatus;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ReadinessStatusBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ReadinessStatus> get serializer => _$ReadinessStatusSerializer();
}

class _$ReadinessStatusSerializer implements PrimitiveSerializer<ReadinessStatus> {
  @override
  final Iterable<Type> types = const [ReadinessStatus, _$ReadinessStatus];

  @override
  final String wireName = r'ReadinessStatus';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ReadinessStatus object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'status';
    yield serializers.serialize(object.status, specifiedType: const FullType(ReadinessStatusStatusEnum));
    yield r'checks';
    yield serializers.serialize(object.checks, specifiedType: const FullType(ReadinessStatusChecks));
  }

  @override
  Object serialize(Serializers serializers, ReadinessStatus object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ReadinessStatusBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'status':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ReadinessStatusStatusEnum),
          ) as ReadinessStatusStatusEnum;
          result.status = valueDes;
          break;
        case r'checks':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ReadinessStatusChecks),
          ) as ReadinessStatusChecks;
          result.checks.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ReadinessStatus deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ReadinessStatusBuilder();
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

class ReadinessStatusStatusEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'ok')
  static const ReadinessStatusStatusEnum ok = _$readinessStatusStatusEnum_ok;
  @BuiltValueEnumConst(wireName: r'error')
  static const ReadinessStatusStatusEnum error = _$readinessStatusStatusEnum_error;

  static Serializer<ReadinessStatusStatusEnum> get serializer => _$readinessStatusStatusEnumSerializer;

  const ReadinessStatusStatusEnum._(String name) : super(name);

  static BuiltSet<ReadinessStatusStatusEnum> get values => _$readinessStatusStatusEnumValues;
  static ReadinessStatusStatusEnum valueOf(String name) => _$readinessStatusStatusEnumValueOf(name);
}
