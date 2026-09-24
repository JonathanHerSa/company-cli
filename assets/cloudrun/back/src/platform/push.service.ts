import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type App, applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

import type { Configuration } from '../config/envs';

export interface PushMessage {
  title: string;
  body: string;
  /** Datos planos para que la app decida qué hacer al tocar la notificación (solo strings). */
  data?: Record<string, string>;
}

/**
 * Único punto de salida a Firebase Cloud Messaging. Sin `FIREBASE_PROJECT_ID` degrada a un no-op con warning.
 *
 * Credenciales, en este orden: (1) clave de cuenta de servicio explícita (`FIREBASE_CLIENT_EMAIL` +
 * `FIREBASE_PRIVATE_KEY`, útil en local); (2) si solo viene `FIREBASE_PROJECT_ID`, credenciales por defecto del
 * entorno (ADC): en Cloud Run es la cuenta de servicio de la propia instancia, con el rol
 * `Firebase Cloud Messaging Admin` en el proyecto de Firebase; así no se guarda ninguna clave privada.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly app: App | null;

  constructor(configService: ConfigService<Configuration, true>) {
    const config = configService.get('firebase', { infer: true });
    if (!config.projectId) {
      this.app = null;
      this.logger.warn('FIREBASE_PROJECT_ID no configurada — push (FCM) deshabilitado');
      return;
    }

    const hasExplicitKey = Boolean(config.clientEmail && config.privateKey);
    this.app =
      getApps()[0] ??
      initializeApp({
        projectId: config.projectId,
        credential: hasExplicitKey
          ? cert({
              projectId: config.projectId,
              clientEmail: config.clientEmail,
              // La env suele venir con `\n` escapados (formato de service account JSON).
              privateKey: config.privateKey.replace(/\\n/g, '\n'),
            })
          : applicationDefault(),
      });
    this.logger.log(
      `Push (FCM) habilitado para '${config.projectId}' con ${hasExplicitKey ? 'clave de cuenta de servicio' : 'credenciales por defecto (ADC)'}`,
    );
  }

  /** Devuelve cuántos dispositivos recibieron el mensaje (0 si FCM está deshabilitado o no hay tokens). */
  async sendToTokens(tokens: string[], message: PushMessage): Promise<number> {
    if (!this.app || tokens.length === 0) {
      return 0;
    }

    try {
      const response = await getMessaging(this.app).sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'high', notification: { channelId: 'alerts' } },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      if (response.failureCount > 0) {
        this.logger.warn(`Push: ${response.successCount} enviados, ${response.failureCount} fallidos`);
      }
      return response.successCount;
    } catch (error) {
      // Sin credenciales válidas (ADC ausente, rol faltante, API de FCM apagada): el push es best-effort,
      // nunca debe tumbar la operación que lo originó.
      this.logger.error(`Push: no se pudo enviar (${error instanceof Error ? error.message : 'unknown error'})`);
      return 0;
    }
  }
}
