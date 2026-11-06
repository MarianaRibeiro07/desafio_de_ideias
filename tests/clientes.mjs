import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const output = process.env.CTI_QA_OUT ?? path.join(os.tmpdir(), 'cti-clientes-qa');
const profile = path.join(output, `clientes-${Date.now()}`);
const base = process.env.CTI_BASE_URL ?? 'http://127.0.0.1:8095';
const executable = process.env.CTI_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const password = 'CtiDemo2026!';
const clientName = `QA Cadastro ${Date.now()}`;
await mkdir(profile, { recursive: true });
const errors = [];
const pending = new Map();
let browser, socket, request = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, condition, details) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`);
  if (!condition) process.exitCode = 1;
}
function cdp(method, params = {}) {
  const id = ++request;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
  return value.result?.value;
}
async function until(expression, label = expression) {
  const end = Date.now() + 15000;
  while (!(await evaluate(expression))) {
    if (Date.now() > end) throw new Error(`Aguardando: ${label}`);
    await pause(100);
  }
}
async function shot(name) {
  await evaluate('document.fonts.ready');
  const value = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(path.join(output, `${name}.png`), Buffer.from(value.data, 'base64'));
}
async function login(email) {
  await cdp('Page.navigate', { url: `${base}/clientes/` });
  await until('!!document.querySelector("#login-view") && !document.querySelector("#login-view").hidden', `login ${email}`);
  await evaluate(`(() => { document.querySelector('#login-email').value=${JSON.stringify(email)};document.querySelector('#login-password').value=${JSON.stringify(password)};document.querySelector('#login-form').requestSubmit(); })()`);
}
async function submitClient(name, city, state) {
  await evaluate(`(() => { document.querySelector('#cliente-nome').value=${JSON.stringify(name)};document.querySelector('#cliente-cidade').value=${JSON.stringify(city)};document.querySelector('#cliente-uf').value=${JSON.stringify(state)};document.querySelector('#cadastro-form').requestSubmit(); })()`);
}

try {
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); }
  }
  if (!port) throw new Error('Navegador nao publicou porta CDP.');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const operation = pending.get(message.id);
      if (operation) { clearTimeout(operation.timer); pending.delete(message.id); message.error ? operation.reject(new Error(message.error.message)) : operation.resolve(message.result); }
    } else if (message.method === 'Runtime.exceptionThrown') errors.push({ type: 'exception', details: message.params.exceptionDetails });
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  await login('rafael@cti.demo');
  await until('document.querySelector("#app-view") && !document.querySelector("#app-view").hidden && document.querySelectorAll("#lista li").length > 0', 'formulario e lista carregados');
  check('Titulo da pagina', (await evaluate('document.title')) === 'CTI Escuta, Cadastro de clientes');
  check('Select de UF com 27 estados', (await evaluate('document.querySelectorAll("#cliente-uf option:not([value=\\"\\"])").length')) === 27);
  check('Link para o sistema geral', await evaluate('[...document.querySelectorAll("a")].some(a => a.getAttribute("href") === "/")'));
  check('Campos com label associado', await evaluate('["cliente-nome","cliente-cidade","cliente-uf","busca"].every(id => document.querySelector(`label[for="${id}"]`))'));

  await submitClient(clientName, 'Campinas', 'SP');
  await until(`document.querySelector('#lista')?.innerText.includes(${JSON.stringify(clientName)})`, 'cliente na lista');
  const row = await evaluate(`(() => { const li = [...document.querySelectorAll('#lista li')].find(li => li.innerText.includes(${JSON.stringify(clientName)})); return li ? li.innerText : null; })()`);
  check('Cliente aparece na lista com cidade e UF', row && /Campinas/.test(row) && /SP/.test(row), row);
  check('Formulario limpo apos cadastro', (await evaluate('document.querySelector("#cliente-nome").value')) === '');
  check('Mensagem de sucesso em regiao aria-live', await evaluate('(() => { const m = document.querySelector("#mensagem"); return m.getAttribute("aria-live") === "polite" && /cadastrado/i.test(m.innerText); })()'));
  await shot('clientes-desktop');

  await submitClient(clientName.toUpperCase(), 'Campinas', 'SP');
  await until('/ja cadastrado|já cadastrado/i.test(document.querySelector("#mensagem")?.innerText ?? "")', 'erro de duplicado');
  check('Duplicado em caixa diferente mostra erro do servidor', await evaluate('document.querySelector("#mensagem").classList.contains("erro")'), await evaluate('document.querySelector("#mensagem").innerText'));
  check('Duplicado nao entra na lista', (await evaluate(`[...document.querySelectorAll('#lista li')].filter(li => li.innerText.toLowerCase().includes(${JSON.stringify(clientName.toLowerCase())})).length`)) === 1);

  await evaluate(`(() => { const b = document.querySelector('#busca'); b.value='campinas'; b.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await pause(200);
  check('Busca por cidade filtra a lista', await evaluate(`(() => { const items = [...document.querySelectorAll('#lista li')]; return items.length >= 1 && items.every(li => /campinas/i.test(li.innerText)); })()`));

  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  const mobile = await evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth})');
  check('Mobile 390 sem rolagem horizontal (atendente)', mobile.width <= mobile.viewport, mobile);
  await shot('clientes-mobile');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  await evaluate('document.querySelector("#sair").click()');
  await until('!document.querySelector("#login-view").hidden', 'logout');
  await login('helena@cti.demo');
  await until('document.querySelector("#acesso-negado") && !document.querySelector("#acesso-negado").hidden', 'acesso negado');
  check('Gestor ve acesso negado sem formulario', await evaluate('document.querySelector("#app-view").hidden && !!document.querySelector("#acesso-negado a[href=\\"/\\"]")'));
  await shot('clientes-negado');
  check('Sem excecoes JS', errors.length === 0, errors);
} catch (error) {
  console.error(error.message);
  console.error('Estado da pagina:', await evaluate('document.querySelector("#mensagem")?.innerText + " | " + JSON.stringify(performance.getEntriesByType("resource").filter(e => e.name.includes("/api")).map(e => e.name.slice(-14) + ":" + e.responseStatus))').catch(() => 'indisponivel'), JSON.stringify(errors).slice(0, 600));
  process.exitCode = 1;
} finally {
  socket?.close();
  browser?.kill();
  await pause(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
