import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
// `mobile_<proyecto>` empieza por "m": queda después de `http` en orden alfabético (directives_ordering).
import 'package:__MOBILE_PACKAGE__/core/config/env.dart';

const _cacheKey = 'client_config';

/// Configuración pública que el Back entrega al cliente (`GET /client-config`). Espeja `ClientConfigService` del Back.
class ClientConfig {
  const ClientConfig({required this.pusherKey, required this.pusherCluster});

  /// Vacío si el Back no tiene Pusher configurado: el cliente no conecta.
  final String pusherKey;
  final String pusherCluster;

  factory ClientConfig.fromJson(Map<String, dynamic> json) {
    final pusher = json['pusher'] as Map<String, dynamic>? ?? const {};
    return ClientConfig(
      pusherKey: pusher['key'] as String? ?? '',
      pusherCluster: pusher['cluster'] as String? ?? 'us2',
    );
  }

  Map<String, dynamic> toJson() => {
    'pusher': {'key': pusherKey, 'cluster': pusherCluster},
  };
}

/// Pide la config al Back y la guarda para arrancar sin red con la última conocida.
class ClientConfigRepository {
  ClientConfigRepository({http.Client? client, FlutterSecureStorage? storage})
    : _client = client ?? http.Client(),
      _storage = storage ?? const FlutterSecureStorage();

  final http.Client _client;
  final FlutterSecureStorage _storage;

  /// Red primero; si falla, la última guardada; `null` si nunca hubo una.
  Future<ClientConfig?> load() async {
    try {
      final res = await _client
          .get(Uri.parse('${Env.apiBaseUrl}/client-config'))
          .timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) throw StateError('HTTP ${res.statusCode}');
      final config = ClientConfig.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
      await _storage.write(key: _cacheKey, value: jsonEncode(config.toJson()));
      return config;
    } catch (_) {
      final cached = await _storage.read(key: _cacheKey);
      if (cached == null) return null;
      try {
        return ClientConfig.fromJson(jsonDecode(cached) as Map<String, dynamic>);
      } catch (_) {
        return null;
      }
    }
  }
}
