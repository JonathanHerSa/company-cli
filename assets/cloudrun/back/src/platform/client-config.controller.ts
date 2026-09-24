import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { type ClientConfig, ClientConfigService } from './client-config.service';

@ApiTags('client-config')
@Controller('client-config')
export class ClientConfigController {
  constructor(private readonly clientConfig: ClientConfigService) {}

  // TODO: cuando exista autenticación, protege esta ruta con el guard de JWT (`@UseGuards(...)`). Solo contiene valores
  // públicos por diseño, pero no hay por qué publicarlos a quien no tenga sesión.
  @ApiOperation({ summary: 'Configuración pública para clientes (key/cluster de Pusher)' })
  @ApiResponse({ status: 200, schema: { example: { pusher: { key: 'abc123', cluster: 'us2' } } } })
  @Get()
  get(): ClientConfig {
    return this.clientConfig.get();
  }
}
