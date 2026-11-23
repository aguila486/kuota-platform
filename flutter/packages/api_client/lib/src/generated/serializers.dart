//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_import

import 'package:one_of_serializer/any_of_serializer.dart';
import 'package:one_of_serializer/one_of_serializer.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/serializer.dart';
import 'package:built_value/standard_json_plugin.dart';
import 'package:built_value/iso_8601_date_time_serializer.dart';
import 'package:api_client/src/generated/date_serializer.dart';
import 'package:api_client/src/generated/model/date.dart';

import 'package:api_client/src/generated/model/compatibility_info.dart';
import 'package:api_client/src/generated/model/compatibility_info_min_supported.dart';
import 'package:api_client/src/generated/model/dependency_status.dart';
import 'package:api_client/src/generated/model/liveness_status.dart';
import 'package:api_client/src/generated/model/problem.dart';
import 'package:api_client/src/generated/model/problem_errors_inner.dart';
import 'package:api_client/src/generated/model/readiness_status.dart';
import 'package:api_client/src/generated/model/readiness_status_checks.dart';

part 'serializers.g.dart';

@SerializersFor([
  CompatibilityInfo,
  CompatibilityInfoMinSupported,
  DependencyStatus,
  LivenessStatus,
  Problem,
  ProblemErrorsInner,
  ReadinessStatus,
  ReadinessStatusChecks,
])
Serializers serializers =
    (_$serializers.toBuilder()
          ..addBuilderFactory(
            const FullType(BuiltList, [FullType(ProblemErrorsInner)]),
            () => ListBuilder<ProblemErrorsInner>(),
          )
          ..add(const OneOfSerializer())
          ..add(const AnyOfSerializer())
          ..add(const DateSerializer())
          ..add(Iso8601DateTimeSerializer()))
        .build();

Serializers standardSerializers = (serializers.toBuilder()..addPlugin(StandardJsonPlugin())).build();
