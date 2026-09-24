import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';

const API = 'https://firebase.googleapis.com/v1beta1';

export interface FirebaseAppOptions {
  /** Proyecto de Firebase (= proyecto de Google Cloud). Debe existir; si aún no es un proyecto de Firebase se le habilita. */
  project: string;
  androidPackage?: string;
  iosBundle?: string;
  /** Destino de `google-services.json` (Android). */
  androidOut?: string;
  /** Destino de `GoogleService-Info.plist` (iOS). */
  iosOut?: string;
  displayName?: string;
  /** No modifica nada (ni en Firebase ni en disco): solo informa qué haría. Las lecturas sí se hacen. */
  dryRun?: boolean;
  /** Reescribe los archivos de configuración aunque ya existan. */
  force?: boolean;
  // Inyectables para pruebas.
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string>;
  pollMs?: number;
}

export interface FirebaseAppResult {
  ok: boolean;
  /** `+` creado/escrito, `=` ya estaba, `·` informativo, `⚠` atención, `✖` error, `➜` lo que se haría (dry-run). */
  lines: string[];
}

interface ApiResponse {
  status: number;
  json: Record<string, unknown>;
}

async function defaultToken(): Promise<string> {
  const { stdout } = await execa('gcloud', ['auth', 'print-access-token']);
  return stdout.trim();
}

/**
 * Crea (si no existen) la app Android y/o iOS de un proyecto de Firebase y descarga su archivo de configuración
 * (`google-services.json` / `GoogleService-Info.plist`) con la API de Firebase Management. Idempotente: una app que ya
 * existe con ese `applicationId` / `bundleId` se reutiliza y un archivo existente no se sobrescribe (salvo `force`).
 * Usa el token de `gcloud` (la cuenta debe poder administrar Firebase en el proyecto).
 *
 * Lo que NO se puede automatizar: subir la llave APNs de iOS (requiere tu cuenta de Apple) ni las capabilities de Xcode.
 */
export async function ensureFirebaseApps(opts: FirebaseAppOptions): Promise<FirebaseAppResult> {
  const lines: string[] = [];
  const note = (mark: string, message: string) => lines.push(`${mark} ${message}`);
  const doFetch = opts.fetchImpl ?? fetch;
  const pollMs = opts.pollMs ?? 2000;
  const token = await (opts.getToken ?? defaultToken)();

  const request = async (method: string, url: string, body?: unknown): Promise<ApiResponse> => {
    const res = await doFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'x-goog-user-project': opts.project,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json };
  };

  const errorText = (r: ApiResponse): string => {
    const error = r.json.error as { message?: string } | undefined;
    return `HTTP ${r.status}${error?.message ? `: ${error.message}` : ''}`;
  };

  /** Operaciones de larga duración (crear app, habilitar Firebase): se consulta hasta que terminan. */
  const waitOperation = async (name: string): Promise<Record<string, unknown>> => {
    for (let i = 0; i < 60; i++) {
      const r = await request('GET', `${API}/${name}`);
      if (r.status !== 200) throw new Error(`operación ${name}: ${errorText(r)}`);
      if (r.json.done) {
        if (r.json.error) throw new Error(`operación ${name}: ${(r.json.error as { message?: string }).message ?? 'falló'}`);
        return (r.json.response ?? {}) as Record<string, unknown>;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error(`operación ${name}: tiempo de espera agotado`);
  };

  const displayName = opts.displayName ?? opts.project;

  // 1) El proyecto debe ser un proyecto de Firebase.
  const project = await request('GET', `${API}/projects/${opts.project}`);
  if (project.status === 200) {
    note('=', `proyecto de Firebase '${opts.project}' activo`);
  } else if (project.status === 404 || project.status === 403) {
    if (opts.dryRun) {
      note('➜', `habilitaría Firebase en el proyecto '${opts.project}'`);
    } else {
      const add = await request('POST', `${API}/projects/${opts.project}:addFirebase`, {});
      if (add.status !== 200) return { ok: false, lines: [...lines, `✖ No se pudo habilitar Firebase en '${opts.project}' (${errorText(add)}). ¿Existe el proyecto y tu cuenta puede administrarlo?`] };
      await waitOperation(String(add.json.name));
      note('+', `Firebase habilitado en '${opts.project}'`);
    }
  } else {
    return { ok: false, lines: [`✖ No se pudo consultar el proyecto de Firebase '${opts.project}' (${errorText(project)})`] };
  }

  /** Crea la app si no existe y devuelve su appId (o `null` en dry-run). */
  const ensureApp = async (kind: 'android' | 'ios', identifier: string): Promise<string | null> => {
    const collection = kind === 'android' ? 'androidApps' : 'iosApps';
    const key = kind === 'android' ? 'packageName' : 'bundleId';
    const label = kind === 'android' ? 'Android' : 'iOS';

    const list = await request('GET', `${API}/projects/${opts.project}/${collection}?pageSize=100`);
    if (list.status === 200) {
      const apps = (list.json.apps ?? []) as Record<string, string>[];
      const found = apps.find((app) => app[key] === identifier);
      if (found) {
        note('=', `app ${label} '${identifier}' ya existe (${found.appId})`);
        return found.appId;
      }
    } else if (list.status !== 404) {
      throw new Error(`listar apps ${label}: ${errorText(list)}`);
    }

    if (opts.dryRun) {
      note('➜', `crearía la app ${label} '${identifier}'`);
      return null;
    }
    const create = await request('POST', `${API}/projects/${opts.project}/${collection}`, { [key]: identifier, displayName });
    if (create.status !== 200) throw new Error(`crear app ${label}: ${errorText(create)}`);
    const created = await waitOperation(String(create.json.name));
    note('+', `app ${label} '${identifier}' creada (${created.appId})`);
    return String(created.appId);
  };

  /** Descarga la configuración de una app y la escribe (sin pisar un archivo existente salvo `force`). */
  const writeConfig = async (kind: 'android' | 'ios', appId: string | null, out: string | undefined): Promise<void> => {
    const label = kind === 'android' ? 'google-services.json' : 'GoogleService-Info.plist';
    if (!out) {
      note('·', `${label}: sin destino (--${kind}-out): no se descarga`);
      return;
    }
    if ((await fs.pathExists(out)) && !opts.force) {
      note('=', `${label} ya existe en ${out} (usa --force para reemplazarlo)`);
      return;
    }
    if (opts.dryRun || !appId) {
      note('➜', `descargaría ${label} a ${out}`);
      return;
    }
    const collection = kind === 'android' ? 'androidApps' : 'iosApps';
    const config = await request('GET', `${API}/projects/${opts.project}/${collection}/${appId}/config`);
    if (config.status !== 200) throw new Error(`descargar ${label}: ${errorText(config)}`);
    const contents = Buffer.from(String(config.json.configFileContents ?? ''), 'base64');
    if (contents.length === 0) throw new Error(`${label}: respuesta vacía`);
    await fs.ensureDir(path.dirname(out));
    await fs.writeFile(out, contents);
    note('+', `${label} escrito en ${out}`);
  };

  try {
    if (opts.androidPackage) {
      await writeConfig('android', await ensureApp('android', opts.androidPackage), opts.androidOut);
    }
    if (opts.iosBundle) {
      await writeConfig('ios', await ensureApp('ios', opts.iosBundle), opts.iosOut);
      note('·', 'iOS: falta subir la llave APNs (.p8) a Firebase y activar Push Notifications / Background Modes en Xcode (requiere tu cuenta de Apple y un Mac)');
    }
  } catch (error) {
    return { ok: false, lines: [...lines, `✖ ${error instanceof Error ? error.message : String(error)}`] };
  }
  return { ok: true, lines };
}
