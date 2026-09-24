import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
// @if hasTypeorm
import { InjectDataSource } from '@nestjs/typeorm';
// @endif
import Redis from 'ioredis';
// @if hasTypeorm
import { DataSource } from 'typeorm';
// @endif

import type { Configuration } from '../../config/envs';

interface HealthResult {
  status: 'ok' | 'error';
  detail?: string;
}

/**
 * Liveness real (no solo "el proceso está vivo"): `/health/db` y `/health/redis` verifican la dependencia.
 * Rutas públicas, pensadas para el orquestador: Cloud Run las usa como *startup probe* y los monitores externos
 * para saber si la API puede atender. Se sirven bajo el prefijo global (`/api/v1/health/...`).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
// @if hasTypeorm
    @InjectDataSource() private readonly dataSource: DataSource,
// @endif
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  @ApiOperation({ summary: 'La API responde' })
  @Get()
  alive(): HealthResult {
    return { status: 'ok' };
  }

// @if hasTypeorm
  @ApiOperation({ summary: 'Conexión a la base de datos' })
  @Get('db')
  async db(): Promise<HealthResult> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch (error) {
      throw new HttpException(
        { status: 'error', detail: error instanceof Error ? error.message : 'unknown error' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

// @endif
  @ApiOperation({ summary: 'Conexión a Redis' })
  @Get('redis')
  async redis(): Promise<HealthResult> {
    const config = this.configService.get('redis', { infer: true });
    const client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.ping();
      return { status: 'ok' };
    } catch (error) {
      throw new HttpException(
        { status: 'error', detail: error instanceof Error ? error.message : 'unknown error' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      client.disconnect();
    }
  }
}
