import Pusher, { type Channel } from 'pusher-js';

let client: Pusher | null = null;

/**
 * `false` si el build no trae `NEXT_PUBLIC_PUSHER_KEY/CLUSTER` (se incrustan al compilar). Consúltalo antes de suscribirte:
 * lanzar dentro de un `useEffect` tumba la pantalla completa; así el portal degrada a "sin tiempo real".
 */
export function isPusherConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PUSHER_KEY && process.env.NEXT_PUBLIC_PUSHER_CLUSTER);
}

/**
 * Instancia única por sesión de navegador. Los canales privados (`private-*`) se autorizan contra el Back: sustituye
 * `authEndpoint` por la ruta de tu BFF/API que llame a `PusherService.authorizeChannel` (decide ahí quién puede qué).
 */
function getPusherClient(): Pusher {
  if (client) return client;

  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  if (!key || !cluster) {
    throw new Error('NEXT_PUBLIC_PUSHER_KEY / NEXT_PUBLIC_PUSHER_CLUSTER no configuradas');
  }

  client = new Pusher(key, { cluster, channelAuthorization: { endpoint: '/api/realtime/pusher/auth', transport: 'ajax' } });
  return client;
}

export function subscribeChannel(name: string): Channel {
  return getPusherClient().subscribe(name);
}

export function unsubscribeChannel(name: string): void {
  client?.unsubscribe(name);
}

/** Llama a `callback` cada vez que el socket se RECONECTA: Pusher no reenvía lo emitido mientras estuvo caído. */
export function onPusherReconnect(callback: () => void): () => void {
  const connection = getPusherClient().connection;
  let hasConnected = connection.state === 'connected';
  const handler = () => {
    if (hasConnected) callback();
    hasConnected = true;
  };
  connection.bind('connected', handler);
  return () => connection.unbind('connected', handler);
}
