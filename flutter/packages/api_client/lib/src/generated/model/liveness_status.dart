//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'liveness_status.g.dart';

/// LivenessStatus
///
/// Properties:
/// * [status]
@BuiltValue()
abstract class LivenessStatus implements Built<LivenessStatus, LivenessStatusBuilder> {
  @BuiltValueField(wireName: r'status')
  LivenessStatusStatusEnum get status;
  // enum statusEnum {  ok,  };

  LivenessStatus._();

  factory LivenessStatus([void updates(LivenessStatusBuilder b)]) = _$LivenessStatus;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(LivenessStatusBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<LivenessStatus> get serializer => _$LivenessStatusSerializer();
}

class _$LivenessStatusSerializer implements PrimitiveSerializer<LivenessStatus> {
  @override
  final Iterable<Type> types = const [LivenessStatus, _$LivenessStatus];

  @override
  final String wireName = r'LivenessStatus';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    LivenessStatus object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'status';
    yield serializers.serialize(object.status, specifiedType: const FullType(LivenessStatusStatusEnum));
  }

  @override
  Object serialize(Serializers serializers, LivenessStatus object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required LivenessStatusBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'status':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(LivenessStatusStatusEnum),
          ) as LivenessStatusStatusEnum;
          result.status = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  LivenessStatus deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = LivenessStatusBuilder();
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

class LivenessStatusStatusEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'ok')
  static const LivenessStatusStatusEnum ok = _$livenessStatusStatusEnum_ok;

  static Serializer<LivenessStatusStatusEnum> get serializer => _$livenessStatusStatusEnumSerializer;

  const LivenessStatusStatusEnum._(String name) : super(name);

  static BuiltSet<LivenessStatusStatusEnum> get values => _$livenessStatusStatusEnumValues;
  static LivenessStatusStatusEnum valueOf(String name) => _$livenessStatusStatusEnumValueOf(name);
}
