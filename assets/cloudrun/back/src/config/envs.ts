import * as Joi from 'joi';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  corsOrigin: string;
  /** Saltos de proxy de confianza. En Cloud Run: `1` (sin esto `req.ip` sería la IP de Google). */
  trustProxy: string;
  /** Documentación de la API (`/reference`). Por defecto solo fuera de producción. */
  enableApiDocs: boolean;
}

// @if hasDb
export interface DatabaseConfig {
  host: string;
  port: number;
  /** Socket Unix de Cloud SQL (`/cloudsql/<proyecto>:<región>:<instancia>`). Si está, se usa en vez de host/port. */
  socketPath: string;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  migrationsRun: boolean;
  poolSize: number;
}
// @endif

export interface JwtConfig {
  secret: string;
  expiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
}

export interface MfaConfig {
  /** 32 bytes en hexadecimal (64 caracteres). No cambiarla después: cifra los secretos de MFA ya guardados. */
  encryptionKey: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailFrom: string;
}

export interface StorageConfig {
  provider: 'gcs' | 'local';
  gcsProjectId: string;
  gcsBucketName: string;
  gcsKeyFilename: string;
}

export interface PusherConfig {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

// @if mobile
export interface FirebaseConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}
// @endif

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
  prefix: string;
}

export interface Configuration {
  app: AppConfig;
// @if hasDb
  database: DatabaseConfig;
// @endif
  jwt: JwtConfig;
  mfa: MfaConfig;
  smtp: SmtpConfig;
  storage: StorageConfig;
  pusher: PusherConfig;
// @if mobile
  firebase: FirebaseConfig;
// @endif
  redis: RedisConfig;
}

/**
 * Única fuente de verdad de variables de entorno: nada fuera de este archivo debe leer `process.env`.
 * `ConfigModule.forRoot` valida contra `envsValidationSchema` antes de arrancar (si falta una obligatoria, la app
 * no levanta y el error nombra la variable) y `configuration()` construye el objeto tipado que el resto consume.
 */
export const envsValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
  TRUST_PROXY: Joi.string().default('loopback, linklocal, uniquelocal'),
  ENABLE_API_DOCS: Joi.boolean().optional(),

// @if hasDb
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(__DB_PORT__),
  DB_SOCKET_PATH: Joi.string().allow('').default(''),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_DATABASE: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_MIGRATIONS_RUN: Joi.boolean().default(false),
  DB_POOL_SIZE: Joi.number().default(10),

// @endif
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('2h'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  MFA_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),

  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().allow('').default(''),

  STORAGE_PROVIDER: Joi.string().valid('gcs', 'local').default('local'),
  GCS_PROJECT_ID: Joi.string().allow('').default(''),
  GCS_BUCKET_NAME: Joi.string().allow('').default(''),
  GCS_KEY_FILENAME: Joi.string().allow('').default(''),

  PUSHER_APP_ID: Joi.string().allow('').default(''),
  PUSHER_KEY: Joi.string().allow('').default(''),
  PUSHER_SECRET: Joi.string().allow('').default(''),
  PUSHER_CLUSTER: Joi.string().default('us2'),

// @if mobile
  FIREBASE_PROJECT_ID: Joi.string().allow('').default(''),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow('').default(''),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('').default(''),

// @endif
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_PREFIX: Joi.string().default('dev:'),
}).unknown(true);

export function configuration(): Configuration {
  const env = process.env;
  const nodeEnv = (env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development';

  return {
    app: {
      nodeEnv,
      port: Number(env.PORT ?? 3000),
      apiPrefix: env.API_PREFIX ?? 'api/v1',
      corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:3001',
      trustProxy: env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal',
      enableApiDocs: env.ENABLE_API_DOCS === undefined ? nodeEnv !== 'production' : env.ENABLE_API_DOCS === 'true',
    },
// @if hasDb
    database: {
      host: env.DB_HOST ?? 'localhost',
      port: Number(env.DB_PORT ?? __DB_PORT__),
      socketPath: env.DB_SOCKET_PATH ?? '',
      username: env.DB_USERNAME ?? '',
      password: env.DB_PASSWORD ?? '',
      database: env.DB_DATABASE ?? '__DB_NAME__',
      synchronize: env.DB_SYNCHRONIZE === 'true',
      migrationsRun: env.DB_MIGRATIONS_RUN === 'true',
      poolSize: Number(env.DB_POOL_SIZE ?? 10),
    },
// @endif
    jwt: {
      secret: env.JWT_SECRET ?? '',
      expiresIn: env.JWT_EXPIRES_IN ?? '2h',
      refreshSecret: env.JWT_REFRESH_SECRET ?? '',
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    },
    mfa: { encryptionKey: env.MFA_ENCRYPTION_KEY ?? '' },
    smtp: {
      host: env.SMTP_HOST ?? '',
      port: Number(env.SMTP_PORT ?? 587),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER ?? '',
      password: env.SMTP_PASSWORD ?? '',
      mailFrom: env.MAIL_FROM ?? '',
    },
    storage: {
      provider: (env.STORAGE_PROVIDER as StorageConfig['provider']) ?? 'local',
      gcsProjectId: env.GCS_PROJECT_ID ?? '',
      gcsBucketName: env.GCS_BUCKET_NAME ?? '',
      gcsKeyFilename: env.GCS_KEY_FILENAME ?? '',
    },
    pusher: {
      appId: env.PUSHER_APP_ID ?? '',
      key: env.PUSHER_KEY ?? '',
      secret: env.PUSHER_SECRET ?? '',
      cluster: env.PUSHER_CLUSTER ?? 'us2',
    },
// @if mobile
    firebase: {
      projectId: env.FIREBASE_PROJECT_ID ?? '',
      clientEmail: env.FIREBASE_CLIENT_EMAIL ?? '',
      privateKey: env.FIREBASE_PRIVATE_KEY ?? '',
    },
// @endif
    redis: {
      host: env.REDIS_HOST ?? 'localhost',
      port: Number(env.REDIS_PORT ?? 6379),
      password: env.REDIS_PASSWORD ?? '',
      prefix: env.REDIS_PREFIX ?? 'dev:',
    },
  };
}
