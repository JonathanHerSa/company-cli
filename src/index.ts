#!/usr/bin/env node
import path from 'path';

import { DEPLOY_COMMANDS, deployHelp, packageVersion, runDeployCommand } from './kit.js';

/**
 * Punto de entrada único. Un solo paquete, varios nombres (`t3zcadev-cli`, `company-cli`, `create-hub-app`, `cloudrun-kit`):
 *   - sin argumentos: asistente interactivo que crea un Hub nuevo (`create` lo pide explícitamente);
 *   - `init | env | bootstrap | flutter-firebase | doctor | guide | where`: despliegue a Google Cloud Run;
 *   - invocado como `cloudrun-kit`, sin argumentos muestra la ayuda de despliegue (no abre el asistente).
 */
async function main(): Promise<void> {
  const invokedAs = path.basename(process.argv[1] ?? 'company-cli').replace(/\.js$/, '');
  const [command, ...args] = process.argv.slice(2);
  const asKit = invokedAs === 'cloudrun-kit';

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(`${invokedAs} ${packageVersion()}`);
    return;
  }
  if (command === 'help' || command === '--help' || command === '-h' || (asKit && !command)) {
    console.log(deployHelp(invokedAs));
    if (!asKit) console.log('Sin argumentos (o con `create`): asistente interactivo para crear un Hub nuevo.');
    return;
  }
  if (command && (DEPLOY_COMMANDS as readonly string[]).includes(command)) {
    process.exit(await runDeployCommand(command, args));
  }
  if (!command || command === 'create') {
    const { runCliPrompts } = await import('./prompts.js');
    await runCliPrompts();
    return;
  }
  console.error(`Comando desconocido: ${command}\n`);
  console.error(deployHelp(invokedAs));
  process.exit(2);
}

main().catch((err) => {
  console.error('❌ Error inesperado al ejecutar el CLI:', err);
  process.exit(1);
});
