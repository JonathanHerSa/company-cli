import type { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

import type { DatabaseConfig } from './envs';

/**
 * Opciones de conexión de TypeORM, una sola vez. La consumen `src/database/data-source.ts` (CLI de
 * migraciones, fuera de Nest) y `DatabaseModule` (dentro de la app), para no duplicar la forma de la conexión.
 */
export function buildDataSourceOptions(database: DatabaseConfig): DataSourceOptions {
  return {
// @if mysql
    type: 'mysql',
    host: database.host,
    port: database.port,
    // Cloud Run + Cloud SQL (`--add-cloudsql-instances`): la conexión va por socket Unix, no por red.
    socketPath: database.socketPath || undefined,
    charset: 'utf8mb4',
// @endif
// @if postgres
    type: 'postgres',
    // Cloud Run + Cloud SQL: en Postgres el socket Unix se pasa como `host` (`/cloudsql/<instancia>`).
    host: database.socketPath || database.host,
    port: database.port,
// @endif
    username: database.username,
    password: database.password,
    database: database.database,
    synchronize: database.synchronize,
    migrationsRun: database.migrationsRun,
    poolSize: database.poolSize,
    namingStrategy: new SnakeNamingStrategy(),
    entities: [__dirname + '/../modules/**/*.entity{.js,.ts}'],
    migrations: [__dirname + '/../database/migrations/**/*{.js,.ts}'],
    migrationsTableName: 'migrations',
  };
}
