import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Configuration } from '../config/envs';

export interface ClientConfig {
  pusher: {
    /** Vacío si Pusher no está configurado en este entorno: el cliente no conecta. */
    key: string;
    cluster: string;
  };
}

/**
 * Configuración que los clientes (móvil) reciben del Back en vez de llevarla en su build: así cambiar de cuenta de
 * Pusher no exige recompilar la app y la key nunca queda desincronizada. Lista EXPLÍCITA de valores públicos por
 * diseño (la key de Pusher viaja en cualquier cliente): nunca se vuelca el `.env` ni se exponen secretos.
 */
@Injectable()
export class ClientConfigService {
  constructor(private readonly configService: ConfigService<Configuration, true>) {}

  get(): ClientConfig {
    const pusher = this.configService.get('pusher', { infer: true });
    return {
      pusher: {
        key: pusher.appId && pusher.secret ? pusher.key : '',
        cluster: pusher.cluster,
      },
    };
  }
}
