import { prepareModels } from './engine.mjs';
import { models } from './engine.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  await prepareModels();
  const cache = process.env.CTI_MODEL_CACHE_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../storage/models');
  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, 'ready.json'), JSON.stringify(models, null, 2));
  console.log('Modelos de sentimento e transcricao preparados para execucao local.');
} catch (error) {
  console.error(`Falha ao preparar modelos: ${error.message}`);
  process.exitCode = 1;
}
