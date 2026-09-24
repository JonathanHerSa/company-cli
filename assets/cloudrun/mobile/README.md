# __PROJECT_NAME__ Mobile

App Flutter. La configuración del build es una sola variable: la URL del Back.

```bash
flutter run --dart-define=API_URL=http://192.168.1.10:3000            # desarrollo (IP de tu equipo en la LAN)
flutter build apk --release --dart-define=API_URL=https://api.midominio.com
```

El emulador Android llega al host por `10.0.2.2`. La key de Pusher NO va en el build: la entrega el Back en
`GET /client-config` (`lib/core/config/client_config.dart`).

## Notificaciones push (Firebase Cloud Messaging)

1. En la consola de Firebase crea el proyecto y una app Android (paquete: el `applicationId` de `android/app/build.gradle.kts`)
   y, si aplica, una app iOS. Descarga `google-services.json` (a `android/app/`) y `GoogleService-Info.plist` (a `ios/Runner/`).
   Ambos están en `.gitignore`: quien compile la app los necesita.
2. Aplica los cambios de Android (idempotente, se puede repetir): `cloudrun-kit flutter-firebase`
   (plugin de Google Services **solo si existe** `google-services.json`, para que sin él el build siga compilando, y el permiso
   `POST_NOTIFICATIONS`, obligatorio desde Android 13 para que las notificaciones se muestren).
3. iOS (requiere Mac): llave APNs (`.p8`) subida a Firebase, y en Xcode las capabilities *Push Notifications* y
   *Background Modes → Remote notifications*.
4. El Back envía el push con `PushService` (`FIREBASE_PROJECT_ID`; en Cloud Run usa las credenciales de su cuenta de
   servicio, sin llave privada).

Sin `google-services.json` la app arranca igual y solo desactiva el push.
