import assert from 'node:assert/strict';
import { decodeWave, describeText, resultFromScores } from '../ai/engine.mjs';

function wav(rate, seconds, amplitude = 2000) {
  const samples = Math.round(rate * seconds);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + i * 2);
  return data;
}
for (const rate of [8000, 16000, 48000]) {
  const samples = decodeWave(wav(rate, 1));
  assert.equal(samples.length, 16000);
  assert.ok(samples.some(value => Math.abs(value) > 0.02));
}
assert.throws(() => decodeWave(Buffer.from('nao e WAV')), /WAV/);
assert.throws(() => decodeWave(wav(16000, 1, 0)), /silenc/i);
assert.throws(() => decodeWave(wav(16000, 61)), /60/);
const text = 'A VPN caiu de novo. Quero cancelar porque a empresa esta parada.';
const detail = describeText(text);
assert.equal(detail.criticality, 'critical');
assert.ok(detail.topics.includes('Conectividade'));
assert.ok(detail.evidence.some(quote => text.includes(quote)));
assert.ok(text.includes(detail.summary));
assert.equal(describeText('Muito obrigado pelo atendimento!').criticality, 'regular');
assert.equal(describeText('Ninguem resolveu meu problema').criticality, 'critical');
assert.equal(describeText('Ninguém resolveu meu problema').criticality, 'critical');
const longSpeech = 'A conexao ficou indisponivel ' + 'durante o atendimento '.repeat(60);
const longDetail = describeText(longSpeech);
assert.ok(longDetail.evidence.every(quote => quote.length <= 1000 && longSpeech.includes(quote)));
const result = resultFromScores([{ label: 'positive', score: 0.05 }, { label: 'negative', score: 0.9 }, { label: 'neutral', score: 0.05 }]);
assert.deepEqual(result, { sentiment: 'negative', confidence: 0.9 });
assert.throws(() => resultFromScores([{ label: 'inventado', score: 0.8 }]), /modelo/i);
assert.throws(() => resultFromScores([{ label: 'positive', score: 2 }]), /modelo/i);
console.log('IA: decodificacao WAV, silencio, duracao, evidencias e resultado do modelo aprovados.');
