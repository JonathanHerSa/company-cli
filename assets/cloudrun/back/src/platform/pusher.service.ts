import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Pusher from 'pusher';

import type { Configuration } from '../config/envs';

const PUSHER_MAX_CHANNELS_PER_TRIGGER = 100;

/**
 * Único punto de salida a Pusher. Sin credenciales (`PUSHER_APP_ID/KEY/SECRET`) degrada a un no-op con warning,
 * para que el desarrollo local no dependa de una cuenta real. Los eventos se emiten en el mismo request que produce
 * el cambio (nada de polling).
 */
@Injectable()
export class PusherService {
  private readonly logger = new Logger(PusherService.name);
  private readonly client: Pusher | null;

  constructor(configService: ConfigService<Configuration, true>) {
    const config = configService.get('pusher', { infer: true });
    this.client =
      config.appId && config.key && config.secret
        ? new Pusher({ appId: config.appId, key: config.key, secret: config.secret, cluster: config.cluster, useTLS: true })
        : null;

    if (!this.client) {
      this.logger.warn('PUSHER_APP_ID/PUSHER_KEY/PUSHER_SECRET no configuradas — eventos en tiempo real deshabilitados');
    }
  }

  /** Pusher admite hasta 100 canales por llamada: se parte en lotes si hace falta. */
  async trigger(channel: string | string[], event: string, data: unknown): Promise<void> {
    if (!this.client) return;
    const channels = Array.isArray(channel) ? channel : [channel];
    for (let i = 0; i < channels.length; i += PUSHER_MAX_CHANNELS_PER_TRIGGER) {
      await this.client.trigger(channels.slice(i, i + PUSHER_MAX_CHANNELS_PER_TRIGGER), event, data);
    }
  }

  /** Firma la suscripción a un canal privado. La autorización (¿puede este usuario?) la decide quien llama. */
  authorizeChannel(socketId: string, channel: string): Pusher.ChannelAuthResponse {
    if (!this.client) {
      throw new Error('Pusher no configurado');
    }
    return this.client.authorizeChannel(socketId, channel);
  }
}
