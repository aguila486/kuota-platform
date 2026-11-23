//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'dependency_status.g.dart';

/// DependencyStatus
///
/// Properties:
/// * [status]
@BuiltValue()
abstract class DependencyStatus implements Built<DependencyStatus, DependencyStatusBuilder> {
  @BuiltValueField(wireName: r'status')
  DependencyStatusStatusEnum get status;
  // enum statusEnum {  up,  down,  };

  DependencyStatus._();

  factory DependencyStatus([void updates(DependencyStatusBuilder b)]) = _$DependencyStatus;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(DependencyStatusBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<DependencyStatus> get serializer => _$DependencyStatusSerializer();
}

class _$DependencyStatusSerializer implements PrimitiveSerializer<DependencyStatus> {
  @override
  final Iterable<Type> types = const [DependencyStatus, _$DependencyStatus];

  @override
  final String wireName = r'DependencyStatus';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    DependencyStatus object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'status';
    yield serializers.serialize(object.status, specifiedType: const FullType(DependencyStatusStatusEnum));
  }

  @override
  Object serialize(Serializers serializers, DependencyStatus object, {FullType specifiedType = FullType.unspecified}) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required DependencyStatusBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'status':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(DependencyStatusStatusEnum),
          ) as DependencyStatusStatusEnum;
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
  DependencyStatus deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = DependencyStatusBuilder();
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

class DependencyStatusStatusEnum extends EnumClass {
  @BuiltValueEnumConst(wireName: r'up')
  static const DependencyStatusStatusEnum up = _$dependencyStatusStatusEnum_up;
  @BuiltValueEnumConst(wireName: r'down')
  static const DependencyStatusStatusEnum down = _$dependencyStatusStatusEnum_down;

  static Serializer<DependencyStatusStatusEnum> get serializer => _$dependencyStatusStatusEnumSerializer;

  const DependencyStatusStatusEnum._(String name) : super(name);

  static BuiltSet<DependencyStatusStatusEnum> get values => _$dependencyStatusStatusEnumValues;
  static DependencyStatusStatusEnum valueOf(String name) => _$dependencyStatusStatusEnumValueOf(name);
}
