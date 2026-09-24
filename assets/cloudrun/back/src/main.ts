import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';

import { AppModule } from './app.module';
import type { Configuration } from './config/envs';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<Configuration, true>);
  const { port, apiPrefix, corsOrigin, trustProxy, enableApiDocs } = configService.get('app', { infer: true });

  // Detrás de un proxy (Cloud Run, nginx) `req.ip` sería la IP del proxy: `trust proxy` toma la IP real del cliente.
  (app.getHttpAdapter().getInstance() as { set: (key: string, value: string) => void }).set('trust proxy', trustProxy);
  app.use(helmet());
  app.enableCors({ origin: corsOrigin });
  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();

  // La documentación expone todo el contrato de la API: solo se sirve fuera de producción (o con ENABLE_API_DOCS=true).
  if (enableApiDocs) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('API Reference').setDescription('Documentación de la API').setVersion('1.0').addBearerAuth().build(),
    );
    app.use('/reference', apiReference({ spec: { content: document } }));
  }

  // 0.0.0.0: Cloud Run consulta el contenedor por su interfaz de red, no por localhost.
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Backend service running on port ${port} (prefix: /${apiPrefix})`);
}

void bootstrap();
