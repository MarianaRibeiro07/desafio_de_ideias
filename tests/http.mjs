import assert from 'node:assert/strict';

const base = process.env.CTI_BASE_URL ?? 'http://127.0.0.1:8095';
let cookie = '', csrf = '', checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log(`PASS ${message}`);
}
async function request(method, route, body, token = true) {
  const headers = { Cookie: cookie };
  if (token) headers['X-CSRF-Token'] = csrf;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + route, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  const set = response.headers.getSetCookie().find(value => value.startsWith('cti_session='));
  if (set) cookie = set.split(';')[0];
  const type = response.headers.get('Content-Type') ?? '';
  const data = type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (data?.data?.csrf_token) csrf = data.data.csrf_token;
  return { status: response.status, headers: response.headers, data };
}
async function login(email) {
  await request('GET', '/api/session');
  const response = await request('POST', '/api/login', { email, password: 'CtiDemo2026!' });
  check(response.status === 200, `HTTP autentica ${email}`);
}
function wav(seconds) {
  const data = Buffer.alloc(48000 * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(data.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
function feedback(ticket, bytes, text) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ticket_id: ticket, rating: 5, resolved: '1', mode: 'audio' })) form.set(key, String(value));
  if (text) form.set('text', text);
  form.set('audio', new Blob([bytes], { type: 'audio/wav' }), 'gravacao.wav');
  return form;
}

const session = await request('GET', '/api/session');
check(session.status === 200 && csrf.length >= 32, 'Sessao HTTP fornece token CSRF');
check(session.headers.get('Set-Cookie')?.includes('HttpOnly') && session.headers.get('Set-Cookie')?.includes('SameSite=Strict'), 'Cookie HTTP possui protecoes de sessao');
check((await request('POST', '/api/login', { email: 'rafael@cti.demo', password: 'CtiDemo2026!' }, false)).status === 419, 'Wrapper HTTP bloqueia mutacao sem token');
for (const route of ['/src/App.php', '/database/schema.sqlite.sql', '/storage/cti.sqlite', '/.git/config', '/api.php']) check((await request('GET', route)).status === 404, `Sem acesso publico a ${route}`);
for (const route of ['/assets/cti-oficial.png', '/assets/inter-400.ttf']) {
  const response = await request('GET', route);
  check(response.status === 200 && response.data.length > 1000, `Asset local ${route}`);
}
await login('rafael@cti.demo');
const created = await request('POST', '/api/tickets', { client_id: 1, subject: `QA HTTP VPN ${Date.now()}`, category_id: 1, channel: 'Portal', priority: 'high' });
check(created.status === 201 && created.data.data.priority === 'high' && created.data.data.support_level === 1 && new Date(created.data.data.response_due_at) - new Date(created.data.data.created_at) === 3600000, 'HTTP persiste novo atendimento com prioridade e prazo calculado no servidor');
const ticket = created.data.data.id;
check((await request('POST', `/api/tickets/${ticket}/solution`, { solution: 'Credenciais renovadas e conexao VPN validada com o cliente.' })).status === 200, 'HTTP envia solucao e aguarda cliente');
const clientName = `QA Cliente ${Date.now()}`;
const newClient = await request('POST', '/api/clients', { name: clientName, city: 'Recife', state: 'PE' });
check(newClient.status === 201 && newClient.data.data.name === clientName && newClient.data.data.city === 'Recife' && newClient.data.data.state === 'PE', 'HTTP cadastra cliente novo com cidade e UF');
check((await request('POST', '/api/clients', { name: `${clientName} sem local` })).status === 400, 'HTTP recusa cliente sem cidade e UF');
check((await request('POST', '/api/clients', { name: clientName.toUpperCase(), city: 'Recife', state: 'PE' })).status === 409, 'HTTP recusa cliente duplicado sem diferenciar caixa');
const reportData = (await request('GET', '/api/reports')).data.data;
check(reportData.agreement === undefined && ['on_time', 'late', 'awaiting_on_time', 'overdue', 'total'].every(key => Number.isInteger(reportData.deadline[key])) && ['low', 'medium', 'high', 'critical'].every(key => Number.isInteger(reportData.by_priority[key])) && ['1', '2', '3'].every(key => Number.isInteger(reportData.by_support_level[key])), 'HTTP devolve deadline, by_priority e by_support_level e nao devolve agreement');
check(/^\d{4}-\d{2}-\d{2}$/.test(reportData.comparison.current.from) && reportData.comparison.previous.to < reportData.comparison.current.from && ['received', 'negative_percent', 'critical', 'negative'].every(key => Number.isInteger(reportData.comparison.previous[key])), 'HTTP devolve a comparacao com o periodo anterior');
const registeredResolved = await request('POST', '/api/tickets', { client_id: newClient.data.data.id, subject: `QA HTTP resolvido ${Date.now()}`, channel: 'Telefone', priority: 'high', status: 'resolved', solution: 'Conexao restabelecida e validada durante a chamada.' });
check(registeredResolved.status === 201 && registeredResolved.data.data.status === 'awaiting_feedback' && registeredResolved.data.data.manual_status_changes === 1, 'HTTP registra atendimento ja resolvido aguardando confirmacao');
await login('marina@cti.demo');
const escalated = await request('POST', `/api/tickets/${ticket}/escalate`, { level: 2 });
check(escalated.status === 200 && escalated.data.data.support_level === 2, 'HTTP escala o atendimento para N2 como supervisor');
check((await request('POST', `/api/tickets/${ticket}/escalate`, { level: 2 })).status === 400, 'HTTP recusa escalar para o mesmo nivel');
await login('lucas@cti.demo');
const tooLong = await request('POST', '/api/feedbacks', feedback(ticket, wav(61)));
check(tooLong.status === 422 && tooLong.data.message.includes('60'), 'Multipart real rejeita WAV de 61 segundos pelo conteudo');
const mixed = await request('POST', '/api/feedbacks', feedback(ticket, wav(60), 'Tambem inclui texto'));
check(mixed.status === 422, 'Multipart real bloqueia audio e texto juntos');
const audioBytes = wav(60);
const accepted = await request('POST', '/api/feedbacks', feedback(ticket, audioBytes));
check(accepted.status === 201, `Multipart recebe 60 segundos e ${audioBytes.length} bytes com limites PHP configurados`);
const id = accepted.data.data.id;
const downloaded = await request('GET', `/api/feedbacks/${id}/audio`);
check(downloaded.status === 200 && downloaded.data.equals(audioBytes), 'Audio privado armazenado integralmente e servido autenticado');
await login('ana@cti.demo');
check((await request('GET', `/api/feedbacks/${id}/audio`)).status === 403, 'HTTP impede acesso de outro cliente ao audio');
await request('POST', '/api/logout');
check((await request('GET', `/api/feedbacks/${id}/audio`)).status === 401, 'HTTP exige login para ouvir audio');
console.log(`${checks} verificacoes HTTP aprovadas.`);
