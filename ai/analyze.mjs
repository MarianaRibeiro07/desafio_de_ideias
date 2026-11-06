import { analyze } from './engine.mjs';

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1000000) throw new Error('Entrada excede limite do processador.');
  }
  const result = await analyze(JSON.parse(input));
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(`Falha na analise local: ${error.message}\n`);
  process.exitCode = 1;
}
