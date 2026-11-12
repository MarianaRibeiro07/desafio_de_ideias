import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const base = (process.env.CTI_BASE_URL ?? 'http://127.0.0.1:18116').replace(/\/$/, '');
const output = process.env.CTI_QA_OUT ?? path.join(os.tmpdir(), `cti-hosted-browser-${Date.now()}`);
const profile = path.join(output, `profile-${Date.now()}`);
const executable = process.env.CTI_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const pending = new Map();
const feedbacks = new Map();
const overrides = new Map();
const calls = [];
const results = [];
const errors = [];
let browser, socket, serial = 0;
let quotaTicket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function check(name, condition, details) {
  results.push({ name, passed: Boolean(condition), details });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`);
  if (!condition) process.exitCode = 1;
}
function cdp(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
  return value.result?.value;
}
async function until(expression, label = expression) {
  const deadline = Date.now() + 15000;
  while (!(await evaluate(expression))) {
    if (Date.now() > deadline) throw new Error(`Aguardando ${label}`);
    await pause(100);
  }
}
async function api(method, route, body) {
  return evaluate(`(async () => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch(${JSON.stringify(route)}, { method: ${JSON.stringify(method)}, credentials: 'same-origin', headers: {${body === undefined ? '' : "'Content-Type':'application/json',"}'X-CSRF-Token':session.data.csrf_token}, ${body === undefined ? '' : `body:JSON.stringify(${JSON.stringify(body)}),`} });
    return { status: response.status, body: await response.json() };
  })()`);
}
async function fulfill(requestId, status, body) {
  await cdp('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
}
async function intercept(params) {
  const url = new URL(params.request.url);
  if (params.responseStatusCode !== undefined) {
    const content = await cdp('Fetch.getResponseBody', { requestId: params.requestId });
    const json = JSON.parse(content.base64Encoded ? Buffer.from(content.body, 'base64').toString() : content.body);
    if (url.pathname === '/api/bootstrap' && json.data) {
      json.data.analysis = { on_demand: true, remaining_requests: 20 - calls.length };
      json.data.feedbacks = json.data.feedbacks.map(feedback => {
        feedbacks.set(Number(feedback.id), feedback);
        return overrides.get(Number(feedback.id)) ?? feedback;
      });
    } else if (url.pathname === '/api/feedbacks' && json.data) feedbacks.set(Number(json.data.id), json.data);
    await fulfill(params.requestId, params.responseStatusCode, json);
    return;
  }
  if (url.origin !== new URL(base).origin) {
    errors.push({ type: 'external-request', url: url.origin });
    await cdp('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' });
    return;
  }
  const match = url.pathname.match(/^\/api\/feedbacks\/(\d+)\/analyze$/);
  if (match) {
    const id = Number(match[1]);
    const feedback = feedbacks.get(id);
    calls.push({ id, method: params.request.method, csrf: Object.entries(params.request.headers).some(([name, value]) => name.toLowerCase() === 'x-csrf-token' && Boolean(value)) });
    if (!feedback) throw new Error(`Feedback ${id} nao foi capturado antes da analise.`);
    if (Number(feedback.ticket_id) === quotaTicket) {
      await fulfill(params.requestId, 429, { message: 'Limite de analises da demonstracao atingido.' });
      return;
    }
    const analyzed = { ...feedback, analysis_status: 'completed', analysis_source: 'gemini_api', analysis_model: 'gemini-3.5-flash-lite', model: 'gemini-3.5-flash-lite', confidence: null, sentiment: 'negative', original_sentiment: 'negative', criticality: 'critical', original_criticality: 'critical', summary: 'O cliente relata indisponibilidade recorrente.', original_summary: 'O cliente relata indisponibilidade recorrente.', topics: ['Conectividade'], evidence: ['A conexao caiu de novo'], transcript: null, transcription_model: null };
    overrides.set(id, analyzed);
    await fulfill(params.requestId, 200, { data: analyzed });
    return;
  }
  await cdp('Fetch.continueRequest', { requestId: params.requestId });
}
async function loginUi(email) {
  const logout = await api('POST', '/api/logout');
  if (logout.status !== 200) throw new Error(`Preparacao do login retornou ${logout.status}.`);
  await cdp('Page.navigate', { url: base });
  await until('!!document.querySelector("#login-form")', 'login pela interface');
  await evaluate(`document.querySelector('#login-email').value=${JSON.stringify(email)};document.querySelector('#login-password').value='CtiDemo2026!';document.querySelector('#login-form').requestSubmit()`);
  await until('!!document.querySelector("nav")', 'menu autenticado');
}
async function sendText(ticketId) {
  await evaluate(`location.hash='#enviar-feedback'`);
  await until(`!!document.querySelector('[data-action="decide"][data-id="${ticketId}"][data-resolved="0"]')`, 'decisao do cliente');
  await evaluate(`document.querySelector('[data-action="decide"][data-id="${ticketId}"][data-resolved="0"]').click()`);
  await until('!!document.querySelector("#feedback-text")', 'formulario de feedback');
  await evaluate(`document.querySelector('#feedback-text').value='A conexao caiu de novo e preciso de uma solucao.';document.querySelector('#feedback-text').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#feedback-form input[name="rating"][value="1"]').checked=true;document.querySelector('#feedback-form input[name="confirmed"]').checked=true;document.querySelector('#feedback-form').requestSubmit()`);
  await until('!!document.querySelector(".success-card")', 'recibo do feedback');
  const deadline = Date.now() + 4000;
  while (!calls.some(call => Number(feedbacks.get(call.id)?.ticket_id) === ticketId) && Date.now() < deadline) await pause(100);
  return [...feedbacks.values()].find(feedback => Number(feedback.ticket_id) === ticketId)?.id;
}

try {
  await mkdir(profile, { recursive: true });
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); } }
  if (!port) throw new Error('Navegador nao publicou porta CDP.');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const operation = pending.get(message.id);
      if (operation) { clearTimeout(operation.timer); pending.delete(message.id); message.error ? operation.reject(new Error(message.error.message)) : operation.resolve(message.result); }
    } else if (message.method === 'Fetch.requestPaused') {
      intercept(message.params).catch(async error => { errors.push({ type: 'interception', message: error.message }); try { await cdp('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' }); } catch {} });
    } else if (message.method === 'Runtime.exceptionThrown') errors.push({ type: 'exception', details: message.params.exceptionDetails });
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Network.enable');
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp('Fetch.enable', { patterns: [{ urlPattern: `${base}/api/feedbacks/*/analyze`, requestStage: 'Request' }, { urlPattern: `${base}/api/bootstrap*`, requestStage: 'Response' }, { urlPattern: `${base}/api/feedbacks`, requestStage: 'Response' }] });
  await cdp('Page.navigate', { url: base });
  await until('!!document.querySelector("#login-form")', 'servidor QA local');
  await api('POST', '/api/login', { email: 'rafael@cti.demo', password: 'CtiDemo2026!' });
  const tickets = [];
  for (const label of ['texto', 'quota']) {
    const created = await api('POST', '/api/tickets', { client_id: 1, subject: `QA Gemini ${label} ${Date.now()}`, channel: 'Portal', priority: 'medium' });
    if (created.status !== 201) throw new Error('Nao foi possivel preparar atendimento local.');
    const id = Number(created.body.data.id);
    await api('POST', `/api/tickets/${id}/solution`, { solution: 'Configuracao ajustada e conectividade conferida.' });
    tickets.push(id);
  }
  quotaTicket = tickets[1];
  await loginUi('lucas@cti.demo');
  check('Login do cliente nao processa falhas nem exemplos do seed', calls.length === 0);
  const first = Number(await sendText(tickets[0]));
  check('Enviar texto dispara exatamente uma analise hospedada', calls.length === 1 && calls[0].id === first, calls);
  if (calls.length !== 1) throw new Error('Disparo automatico da analise hospedada ausente ou repetido.');
  check('Analise automatica usa POST autenticado com token CSRF', calls[0].method === 'POST' && calls[0].csrf);
  await cdp('Page.reload');
  await until('!!document.querySelector("nav")', 'reabertura do cliente');
  await pause(600);
  check('Reabrir resultado concluido nao repete chamada Gemini', calls.length === 1);

  await loginUi('marina@cti.demo');
  await evaluate(`location.hash='#feedbacks'`);
  await until(`!!document.querySelector('[data-action="feedback-detail"][data-id="${first}"]')`, 'feedback analisado na supervisao');
  await evaluate(`document.querySelector('[data-action="feedback-detail"][data-id="${first}"]').click()`);
  await until('!!document.querySelector("#feedback-analysis")', 'detalhe da analise');
  const detail = await evaluate('document.querySelector("#feedback-analysis").innerText');
  check('Detalhe identifica Gemini como origem da analise', /gemini/i.test(detail), detail);
  check('Detalhe mostra resumo e evidencia recebidos da API simulada', detail.includes('indisponibilidade recorrente') && detail.includes('A conexao caiu de novo'));
  check('Detalhe nao apresenta porcentagem de confianca inventada', !/\d+(?:[.,]\d+)?\s*%/.test(detail));
  check('Resultado Gemini nao e identificado como IA local', !/IA local|regras locais/i.test(detail));
  await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }).then(value => writeFile(path.join(output, 'gemini-detalhe.png'), Buffer.from(value.data, 'base64')));

  await loginUi('lucas@cti.demo');
  const failing = Number(await sendText(quotaTicket));
  check('Limite429 faz somente uma solicitacao para o novo feedback', calls.filter(call => call.id === failing).length === 1, calls);
  check('Falha da analise preserva recibo do feedback enviado', await evaluate('!!document.querySelector(".success-card")'));
  await pause(6100);
  check('Polling de pendencias nao repete chamada recusada por cota', calls.filter(call => call.id === failing).length === 1);
  await cdp('Page.reload');
  await until('!!document.querySelector("nav")', 'reabertura apos limite');
  await pause(600);
  check('Reabrir apos429 nao dispara nova tentativa automatica', calls.filter(call => call.id === failing).length === 1);
  await loginUi('marina@cti.demo');
  await evaluate(`location.hash='#feedbacks'`);
  await until(`!!document.querySelector('[data-action="feedback-detail"][data-id="${failing}"]')`, 'relato pendente na supervisao');
  await evaluate(`document.querySelector('[data-action="feedback-detail"][data-id="${failing}"]').click()`);
  await until(`!!document.querySelector('[data-action="analyze-feedback"][data-id="${failing}"]')`, 'botao de analise manual');
  await evaluate(`document.querySelector('[data-action="analyze-feedback"][data-id="${failing}"]').click()`);
  const manualDeadline = Date.now() + 4000;
  while (calls.filter(call => call.id === failing).length < 2 && Date.now() < manualDeadline) await pause(100);
  await pause(300);
  check('Tentativa manual explicita faz uma nova solicitacao apos429', calls.filter(call => call.id === failing).length === 2);
  check('Botao manual volta a ficar disponivel apos resposta429', await evaluate(`(() => { const button = document.querySelector('[data-action="analyze-feedback"][data-id="${failing}"]'); return Boolean(button) && !button.disabled; })()`));
  await pause(6100);
  check('Falha da tentativa manual nao inicia repeticao automatica', calls.filter(call => call.id === failing).length === 2);
  check('Nenhuma analise de outro feedback foi disparada', calls.length === 3 && calls.every(call => call.id === first || call.id === failing), calls);
  check('Sem excecoes de JavaScript ou acesso a servicos externos', errors.length === 0, errors);
} catch (error) {
  errors.push({ type: 'qa', message: error.message });
  if (socket?.readyState === WebSocket.OPEN) { try { console.log(`DEBUG ${JSON.stringify(await evaluate('({url:location.href,title:document.title,text:document.body.innerText.slice(0,500)})'))}`); } catch {} }
  check('Execucao do navegador hospedado', false, error.message);
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'resultado-hospedado.json'), JSON.stringify({ passed: !process.exitCode && errors.length === 0, results, errors, interceptedAnalysisCalls: calls, externalGeminiCalls: 0 }, null, 2));
  console.log(`RESULT ${results.filter(result => result.passed).length}/${results.length}; Gemini real: 0 chamadas.`);
  if (socket?.readyState === WebSocket.OPEN) { try { await cdp('Browser.close'); } catch {} socket.close(); }
  browser?.kill();
}
