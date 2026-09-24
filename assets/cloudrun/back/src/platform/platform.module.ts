import { Global, Module } from '@nestjs/common';

import { ClientConfigController } from './client-config.controller';
import { ClientConfigService } from './client-config.service';
// @if mobile
import { PushService } from './push.service';
// @endif
import { PusherService } from './pusher.service';

/**
 * Infraestructura transversal (`@Global`): cualquier módulo de dominio inyecta `PusherService`/`PushService` sin
 * importar este módulo.
 */
@Global()
@Module({
  controllers: [ClientConfigController],
// @if mobile
  providers: [PusherService, PushService, ClientConfigService],
  exports: [PusherService, PushService],
// @else
  providers: [PusherService, ClientConfigService],
  exports: [PusherService],
// @endif
})
export class PlatformModule {}
