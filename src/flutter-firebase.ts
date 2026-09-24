import fs from 'fs-extra';
import path from 'path';

const PLUGIN_ID = 'com.google.gms.google-services';
const PLUGIN_VERSION = '4.4.2';

export interface FirebaseReport {
  ok: boolean;
  /** Una línea por cambio: `+` aplicado, `=` ya estaba, `·` informativo, `⚠` atención, `✖` error. */
  lines: string[];
}

/**
 * Prepara una app Flutter para notificaciones push (FCM) en Android, de forma IDEMPOTENTE:
 *  - plugin de Google Services declarado (`apply false`) y APLICADO SOLO SI existe `android/app/google-services.json`
 *    (sin el archivo el build sigue compilando y la app degrada a "push deshabilitado");
 *  - *core library desugaring* (lo exige `flutter_local_notifications`; sin él el build falla);
 *  - permiso `POST_NOTIFICATIONS` (obligatorio desde Android 13 para que las notificaciones se muestren);
 *  - `google-services.json` y `GoogleService-Info.plist` en `.gitignore`;
 *  - avisa si el `google-services.json` no incluye el `applicationId` de la app.
 * Requiere Gradle con Kotlin DSL (lo que genera `flutter create` actual). iOS (APNs y capabilities) sigue siendo manual.
 */
export async function applyFlutterFirebase(root: string): Promise<FirebaseReport> {
  const lines: string[] = [];
  const note = (mark: string, message: string) => lines.push(`${mark} ${message}`);

  const settings = path.join(root, 'android', 'settings.gradle.kts');
  const appGradle = path.join(root, 'android', 'app', 'build.gradle.kts');
  const manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

  if (!(await fs.pathExists(path.join(root, 'pubspec.yaml')))) {
    return { ok: false, lines: [`✖ No es un proyecto Flutter (${path.join(root, 'pubspec.yaml')} no existe)`] };
  }
  if (!(await fs.pathExists(path.join(root, 'android')))) {
    return { ok: false, lines: ['✖ Falta android/: ejecuta antes  flutter create --platforms=android,ios .'] };
  }
  if (!(await fs.pathExists(settings)) || !(await fs.pathExists(appGradle))) {
    return {
      ok: false,
      lines: [
        '✖ Solo se parchea Gradle con Kotlin DSL (settings.gradle.kts / app/build.gradle.kts).',
        `  Aplica a mano: plugin ${PLUGIN_ID} (apply false en settings; apply si existe google-services.json en app).`,
      ],
    };
  }

  // 1) settings.gradle.kts: declarar el plugin (apply false) en el bloque `plugins {}`
  let text = await fs.readFile(settings, 'utf8');
  if (text.includes(PLUGIN_ID)) {
    note('=', 'settings.gradle.kts: plugin ya declarado');
  } else {
    const match = /(plugins\s*\{[\s\S]*?)(\n\})/.exec(text);
    if (!match) return { ok: false, lines: ['✖ No encontré el bloque plugins {} en settings.gradle.kts'] };
    const insert =
      '\n    // Firebase (push). Solo se aplica en app/build.gradle.kts si existe google-services.json.' +
      `\n    id("${PLUGIN_ID}") version "${PLUGIN_VERSION}" apply false`;
    const at = match.index + match[1].length;
    await fs.writeFile(settings, text.slice(0, at) + insert + text.slice(at));
    note('+', 'settings.gradle.kts: plugin declarado');
  }

  // 2) app/build.gradle.kts: aplicarlo solo si existe google-services.json
  text = await fs.readFile(appGradle, 'utf8');
  if (text.includes(PLUGIN_ID)) {
    note('=', 'app/build.gradle.kts: aplicación condicional ya presente');
  } else {
    const block =
      '// Firebase Cloud Messaging: el plugin genera los recursos de configuración a partir de `google-services.json`\n' +
      '// (se baja de la consola de Firebase y NO se versiona) y falla el build si no existe. Se aplica solo cuando está el\n' +
      '// archivo, para que quien aún no lo tenga (o un build sin push) siga compilando; sin él la app degrada a "push deshabilitado".\n' +
      'if (file("google-services.json").exists()) {\n' +
      `    apply(plugin = "${PLUGIN_ID}")\n` +
      '}\n\n';
    const androidBlock = /^android\s*\{/m.exec(text);
    if (!androidBlock) return { ok: false, lines: ['✖ No encontré el bloque android {} en app/build.gradle.kts'] };
    await fs.writeFile(appGradle, text.slice(0, androidBlock.index) + block + text.slice(androidBlock.index));
    note('+', 'app/build.gradle.kts: aplicación condicional añadida');
  }

  // 2b) core library desugaring: lo exige flutter_local_notifications; sin él el build falla
  const pubspec = await fs.readFile(path.join(root, 'pubspec.yaml'), 'utf8');
  if (pubspec.includes('flutter_local_notifications')) {
    text = await fs.readFile(appGradle, 'utf8');
    let changed = false;
    if (!text.includes('isCoreLibraryDesugaringEnabled')) {
      const compileOptions = /(compileOptions\s*\{[^}]*?)(\n\s*\})/.exec(text);
      if (compileOptions) {
        const at = compileOptions.index + compileOptions[1].length;
        text =
          text.slice(0, at) +
          '\n        // `flutter_local_notifications` lo exige (usa java.time desugarizado).\n        isCoreLibraryDesugaringEnabled = true' +
          text.slice(at);
        changed = true;
      } else {
        note('⚠', 'No encontré compileOptions {} en app/build.gradle.kts: habilita isCoreLibraryDesugaringEnabled a mano');
      }
    }
    if (!text.includes('coreLibraryDesugaring(')) {
      text = `${text.replace(/\n+$/, '')}\n\ndependencies {\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")\n}\n`;
      changed = true;
    }
    if (changed) {
      await fs.writeFile(appGradle, text);
      note('+', 'app/build.gradle.kts: core library desugaring (requerido por flutter_local_notifications)');
    } else {
      note('=', 'app/build.gradle.kts: core library desugaring ya presente');
    }
  }

  // 3) AndroidManifest.xml: permiso de notificaciones (Android 13+)
  text = await fs.readFile(manifest, 'utf8');
  if (text.includes('POST_NOTIFICATIONS')) {
    note('=', 'AndroidManifest.xml: POST_NOTIFICATIONS ya declarado');
  } else {
    const permission =
      '    <!-- Android 13+ (API 33): sin este permiso las notificaciones push no se muestran. -->\n' +
      '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>\n';
    const last = text.lastIndexOf('<uses-permission');
    if (last >= 0) {
      const end = text.indexOf('\n', last) + 1;
      text = text.slice(0, end) + permission + text.slice(end);
    } else {
      const manifestTag = /<manifest[^>]*>\n/.exec(text);
      if (!manifestTag) return { ok: false, lines: ['✖ No encontré <manifest> en AndroidManifest.xml'] };
      const end = manifestTag.index + manifestTag[0].length;
      text = text.slice(0, end) + permission + text.slice(end);
    }
    await fs.writeFile(manifest, text);
    note('+', 'AndroidManifest.xml: permiso POST_NOTIFICATIONS añadido');
  }

  // 4) .gitignore: archivos de Firebase fuera de git
  const gitignore = path.join(root, '.gitignore');
  const existing = (await fs.pathExists(gitignore)) ? await fs.readFile(gitignore, 'utf8') : '';
  const missing = ['google-services.json', 'GoogleService-Info.plist'].filter((name) => !existing.includes(name));
  if (missing.length > 0) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    await fs.appendFile(gitignore, `${prefix}\n# Firebase (se bajan de la consola; no se versionan)\n${missing.join('\n')}\n`);
    note('+', `.gitignore: ${missing.join(', ')}`);
  } else {
    note('=', '.gitignore: ya ignora los archivos de Firebase');
  }

  // 5) estado de google-services.json y coincidencia de paquete
  const services = path.join(root, 'android', 'app', 'google-services.json');
  const applicationId = /applicationId\s*=\s*"([^"]+)"/.exec(await fs.readFile(appGradle, 'utf8'))?.[1];
  if (await fs.pathExists(services)) {
    let packages: string[] = [];
    try {
      const json = (await fs.readJson(services)) as { client?: { client_info?: { android_client_info?: { package_name?: string } } }[] };
      packages = (json.client ?? []).map((c) => c.client_info?.android_client_info?.package_name ?? '').filter(Boolean);
    } catch {
      packages = [];
    }
    if (applicationId && packages.includes(applicationId)) {
      note('✔', `google-services.json presente y coincide con applicationId (${applicationId})`);
    } else {
      note('⚠', `google-services.json presente pero NO incluye el applicationId ${applicationId} (paquetes: ${packages.join(', ') || '?'})`);
    }
  } else {
    note('·', `falta android/app/google-services.json (paquete a registrar en Firebase: ${applicationId})`);
  }
  lines.push(
    '',
    'iOS (requiere Mac): GoogleService-Info.plist en ios/Runner, llave APNs subida a Firebase y, en Xcode, las capabilities',
    'Push Notifications y Background Modes → Remote notifications.',
  );
  return { ok: true, lines };
}
