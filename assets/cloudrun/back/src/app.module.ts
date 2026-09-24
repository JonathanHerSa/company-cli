import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HealthController } from './common/controllers/health.controller';
import { configuration, envsValidationSchema } from './config/envs';
// @if hasTypeorm
import { DatabaseModule } from './database/database.module';
// @endif
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envsValidationSchema,
    }),
// @if hasTypeorm
    DatabaseModule,
// @endif
    PlatformModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
