/// Configuración de compilación. Se pasa con `--dart-define` (o `--dart-define-from-file=env/dev.json`):
///
///   flutter run --dart-define=API_URL=http://192.168.1.10:3000
///   flutter build apk --release --dart-define=API_URL=https://api.midominio.com
///
/// Solo la URL del Back vive en el build (es lo que la app necesita para preguntarle todo lo demás). Lo demás (key de
/// Pusher, etc.) lo entrega el Back en `GET /client-config` (ver `client_config.dart`): así no hay que recompilar para
/// cambiar de cuenta y no se desincroniza con el servidor.
///
/// El emulador Android necesita `10.0.2.2`, no `localhost`, para llegar al host.
class Env {
  const Env._();

  static const String _rawBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: String.fromEnvironment('API_URL'),
  );

  static const String _defaultUrl = 'http://10.0.2.2:3000';

  /// URL base normalizada: sin `/` final y terminada en `/__API_PREFIX__` (se añade sola si falta).
  static String get apiBaseUrl {
    final raw = _rawBaseUrl.trim().isEmpty ? _defaultUrl : _rawBaseUrl.trim();
    final normalized = raw.endsWith('/') ? raw.substring(0, raw.length - 1) : raw;
    return normalized.endsWith('/__API_PREFIX__') ? normalized : '$normalized/__API_PREFIX__';
  }
}
