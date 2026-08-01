#!/usr/bin/env node
import { runCliPrompts } from './prompts.js';

runCliPrompts().catch((err) => {
  console.error('❌ Error inesperado al ejecutar el CLI:', err);
  process.exit(1);
});
