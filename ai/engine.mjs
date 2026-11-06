import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const models = {
  sentiment: { id: 'onnx-community/twitter-xlm-roberta-base-sentiment-ONNX', revision: '3112e85dea04f0019bf01282916588e3c9dd9bc8' },
  transcription: { id: 'Xenova/whisper-tiny', revision: '5332fcc35e32a33b86612b9a57a89be7906102b1' },
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pipelines = new Map();

async function loadPipeline(kind, download = false) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = process.env.CTI_MODEL_CACHE_PATH || path.join(root, 'storage', 'models');
  env.backends.onnx.logLevel = 'fatal';
  const key = `${kind}:${download}`;
  if (!pipelines.has(key)) {
    const model = models[kind];
    pipelines.set(key, pipeline(kind === 'sentiment' ? 'text-classification' : 'automatic-speech-recognition', model.id, {
      revision: model.revision,
      dtype: 'q8',
      device: 'cpu',
      local_files_only: !download,
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
      progress_callback: download ? progress => {
        if (progress.status === 'done') process.stderr.write(`Modelo local: ${kind}/${progress.file}\n`);
      } : undefined,
    }));
  }
  return pipelines.get(key);
}

export async function prepareModels() {
  for (const kind of ['sentiment', 'transcription']) {
    const model = await loadPipeline(kind, true);
    await model.dispose();
  }
}

export function decodeWave(data) {
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Gravacao WAV invalida.');
  let format, samples;
  for (let offset = 12; offset + 8 <= data.length;) {
    const name = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > data.length) throw new Error('Gravacao WAV truncada.');
    if (name === 'fmt ' && size >= 16) format = { codec: data.readUInt16LE(start), channels: data.readUInt16LE(start + 2), rate: data.readUInt32LE(start + 4), bits: data.readUInt16LE(start + 14) };
    if (name === 'data') samples = data.subarray(start, start + size);
    offset = start + size + size % 2;
  }
  if (!format || !samples || format.codec !== 1 || format.channels !== 1 || format.bits !== 16 || format.rate < 8000 || format.rate > 192000 || samples.length % 2) throw new Error('Use WAV PCM mono de 16 bits.');
  const count = samples.length / 2;
  const seconds = count / format.rate;
  if (seconds < 0.1 || seconds > 60) throw new Error('A gravacao precisa ter entre 0,1 e 60 segundos.');
  const source = new Float32Array(count);
  let energy = 0;
  for (let i = 0; i < count; i++) { source[i] = samples.readInt16LE(i * 2) / 32768; energy += source[i] ** 2; }
  if (Math.sqrt(energy / count) < 0.001) throw new Error('Gravacao silenciosa. Grave novamente com voz audivel.');
  if (format.rate === 16000) return source;
  const result = new Float32Array(Math.round(seconds * 16000));
  const ratio = format.rate / 16000;
  for (let i = 0; i < result.length; i++) {
    if (ratio > 1) {
      const from = Math.floor(i * ratio), to = Math.min(count, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = from; j < to; j++) sum += source[j];
      result[i] = sum / (to - from);
    } else {
      const position = i * ratio, left = Math.floor(position), fraction = position - left;
      result[i] = source[left] * (1 - fraction) + source[Math.min(left + 1, count - 1)] * fraction;
    }
  }
  return result;
}

const alerts = /cancel|cobran[cç]a indevida|fraude|processo judicial|ningu[eé]m resolveu|v[aá]rias vezes|tr[eê]s vezes|supervisor|indispon|parad[ao]|preju[ií]zo|faturamento|caiu de novo/i;
const topics = [
  ['Conectividade', /vpn|conex[aã]o|internet|link|rede|wi-?fi/i],
  ['Cloud e backup', /cloud|nuvem|backup|armazenamento/i],
  ['Segurança', /firewall|seguran[cç]a|fraude|senha|credencia/i],
  ['Cobrança', /cobran[cç]a|pagamento|fatura|boleto/i],
  ['Atendimento', /atend|suporte|demora|resposta|supervisor/i],
  ['Cancelamento', /cancel/i],
];

export function describeText(text) {
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map(value => value.trim()).filter(Boolean) || [text];
  const evidence = sentences.filter(value => alerts.test(value)).slice(0, 4).map(value => value.slice(0, 1000));
  const selected = sentences.slice(0, 3).join(' ');
  return {
    summary: selected.slice(0, 500),
    topics: topics.filter(([, expression]) => expression.test(text)).map(([name]) => name),
    evidence,
    criticality: evidence.length ? 'critical' : 'regular',
  };
}

export function resultFromScores(scores) {
  if (!Array.isArray(scores) || !scores.length) throw new Error('Resultado do modelo invalido.');
  const best = [...scores].sort((a, b) => b.score - a.score)[0];
  const sentiment = String(best.label).toLowerCase();
  if (!['positive', 'neutral', 'negative'].includes(sentiment) || !Number.isFinite(best.score) || best.score < 0 || best.score > 1) throw new Error('Resultado do modelo invalido.');
  return { sentiment, confidence: best.score };
}

export async function analyze({ text, audio_path: audioPath }) {
  let transcript = null;
  if (audioPath) {
    const waveform = decodeWave(await readFile(audioPath));
    const transcriber = await loadPipeline('transcription');
    const output = await transcriber(waveform, { language: 'portuguese', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, max_new_tokens: 224 });
    transcript = String(output.text || '').trim().replace(/[\u2014\u2013\u2212]/g, ', ');
    text = transcript;
  }
  if (typeof text !== 'string' || !text.trim()) throw new Error('Nao foi possivel identificar fala ou texto para analisar.');
  const classifier = await loadPipeline('sentiment');
  const scores = await classifier(text.trim(), { top_k: null, truncation: true, max_length: 512 });
  return { transcript, ...resultFromScores(scores), ...describeText(text.trim()), model: models.sentiment.id, transcription_model: transcript !== null ? models.transcription.id : null };
}
