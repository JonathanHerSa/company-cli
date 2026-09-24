import 'reflect-metadata';

import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

import { configuration } from '../config/envs';
import { buildDataSourceOptions } from '../config/typeorm-options';

dotenv.config();

// El CLI de TypeORM exige que el archivo exporte exactamente una instancia de DataSource.
export default new DataSource(buildDataSourceOptions(configuration().database));
