import assert from 'node:assert/strict';
import { analyze } from '../ai/engine.mjs';

if (process.env.CTI_TEST_OFFLINE === '1') globalThis.fetch = async () => { throw new Error('Rede desabilitada durante o teste local.'); };

const positive = await analyze({ text: 'Muito obrigado, o atendimento foi excelente e resolveu tudo.' });
assert.equal(positive.sentiment, 'positive');
assert.ok(positive.confidence > 0 && positive.confidence <= 1);
const negative = await analyze({ text: 'O atendimento foi horrivel. Ninguem resolveu e quero cancelar.' });
assert.equal(negative.sentiment, 'negative');
assert.equal(negative.criticality, 'critical');
assert.ok(negative.evidence.length > 0);
console.log(JSON.stringify({ positive, negative }));
const neutral = await analyze({ text: 'O protocolo do atendimento e 12345.' });
assert.equal(neutral.sentiment, 'neutral');
console.log(JSON.stringify({ neutral }));
if (process.argv[2]) {
  const audio = await analyze({ audio_path: process.argv[2] });
  assert.ok(audio.transcript?.length > 10);
  assert.ok(audio.transcription_model?.includes('whisper'));
  assert.ok(['positive', 'neutral', 'negative'].includes(audio.sentiment));
  console.log(JSON.stringify({ audio }));
}
console.log('Inferencia real aprovada.');
