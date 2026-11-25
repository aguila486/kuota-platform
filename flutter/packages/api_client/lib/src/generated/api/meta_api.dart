//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

import 'dart:async';

import 'package:built_value/json_object.dart';
import 'package:built_value/serializer.dart';
import 'package:dio/dio.dart';

import 'package:api_client/src/generated/model/compatibility_info.dart';
import 'package:api_client/src/generated/model/problem.dart';

class MetaApi {
  final Dio _dio;

  final Serializers _serializers;

  const MetaApi(this._dio, this._serializers);

  /// Versión de API y versión mínima soportada por app.
  /// Público (excepción registrada). Las apps lo consultan antes de autenticarse.
  ///
  /// Parameters:
  /// * [xAppVersion] - Formato `<app>/<semver>+<build>`, p. ej. `collector/1.4.2+120`.
  /// * [xCorrelationId] - UUID de correlación; si falta, el servidor genera uno y lo devuelve.
  /// * [cancelToken] - A [CancelToken] that can be used to cancel the operation
  /// * [headers] - Can be used to add additional headers to the request
  /// * [extras] - Can be used to add flags to the request
  /// * [validateStatus] - A [ValidateStatus] callback that can be used to determine request success based on the HTTP status of the response
  /// * [onSendProgress] - A [ProgressCallback] that can be used to get the send progress
  /// * [onReceiveProgress] - A [ProgressCallback] that can be used to get the receive progress
  ///
  /// Returns a [Future] containing a [Response] with a [CompatibilityInfo] as data
  /// Throws [DioException] if API call or serialization fails
  Future<Response<CompatibilityInfo>> getCompatibility({
    String? xAppVersion,
    String? xCorrelationId,
    CancelToken? cancelToken,
    Map<String, dynamic>? headers,
    Map<String, dynamic>? extra,
    ValidateStatus? validateStatus,
    ProgressCallback? onSendProgress,
    ProgressCallback? onReceiveProgress,
  }) async {
    final _path = r'/v1/meta/compatibility';
    final _options = Options(
      method: r'GET',
      headers: <String, dynamic>{
        if (xAppVersion != null) r'X-App-Version': xAppVersion,
        if (xCorrelationId != null) r'X-Correlation-Id': xCorrelationId,
        ...?headers,
      },
      extra: <String, dynamic>{'secure': <Map<String, String>>[], ...?extra},
      validateStatus: validateStatus,
    );

    final _response = await _dio.request<Object>(
      _path,
      options: _options,
      cancelToken: cancelToken,
      onSendProgress: onSendProgress,
      onReceiveProgress: onReceiveProgress,
    );

    CompatibilityInfo? _responseData;

    try {
      final rawResponse = _response.data;
      _responseData = rawResponse == null
          ? null
          : _serializers.deserialize(rawResponse, specifiedType: const FullType(CompatibilityInfo))
                as CompatibilityInfo;
    } catch (error, stackTrace) {
      throw DioException(
        requestOptions: _response.requestOptions,
        response: _response,
        type: DioExceptionType.unknown,
        error: error,
        stackTrace: stackTrace,
      );
    }

    return Response<CompatibilityInfo>(
      data: _responseData,
      headers: _response.headers,
      isRedirect: _response.isRedirect,
      requestOptions: _response.requestOptions,
      redirects: _response.redirects,
      statusCode: _response.statusCode,
      statusMessage: _response.statusMessage,
      extra: _response.extra,
    );
  }
}
