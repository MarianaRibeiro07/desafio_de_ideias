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
const clientEmail = `qa.empresa.${Date.now()}@cti.demo`;
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
async function api(method, route, body) {
  return evaluate(`(async () => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch(${JSON.stringify(route)}, {method:${JSON.stringify(method)},headers:{${body === undefined ? '' : "'Content-Type':'application/json',"}'X-CSRF-Token':session.data.csrf_token},${body === undefined ? '' : `body:JSON.stringify(${JSON.stringify(body)}),`}credentials:'same-origin'});
    return {status:response.status,body:await response.json().catch(() => null)};
  })()`);
}
const card = name => `[...document.querySelectorAll('#lista li')].find(li => li.querySelector('.item-nome')?.textContent === ${JSON.stringify(name)})`;
async function submitClient(name, city, state, email = '') {
  await evaluate(`(() => { document.querySelector('#cliente-nome').value=${JSON.stringify(name)};document.querySelector('#cliente-cidade').value=${JSON.stringify(city)};document.querySelector('#cliente-uf').value=${JSON.stringify(state)};const e=document.querySelector('#cliente-email');if(e)e.value=${JSON.stringify(email)};document.querySelector('#cadastro-form').requestSubmit(); })()`);
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
  check('Campos com label associado', await evaluate('["cliente-nome","cliente-cidade","cliente-uf","cliente-email","busca"].every(id => document.querySelector(`label[for="${id}"]`))'));
  check('Formulario na ordem nome, e-mail, cidade e UF', (await evaluate(`[...document.querySelectorAll('#cadastro-form input, #cadastro-form select')].map(e => e.id).join('|')`)) === 'cliente-nome|cliente-email|cliente-cidade|cliente-uf');
  check('Campo de e-mail de acesso obrigatorio com rotulo e dica da senha padrao', await evaluate(`(() => { const e = document.querySelector('#cliente-email'); const hint = document.getElementById(e?.getAttribute('aria-describedby') ?? ''); return e?.type === 'email' && e.required && document.querySelector('label[for="cliente-email"]').textContent.trim() === 'E-mail de acesso da empresa' && /senha padrão/.test(hint?.textContent ?? ''); })()`));

  await submitClient(`${clientName} sem email`, 'Campinas', 'SP');
  await until('document.querySelector("#mensagem")?.classList.contains("erro")', 'erro sem e-mail');
  check('Cadastro sem e-mail e recusado na tela', /e-mail/i.test(await evaluate('document.querySelector("#mensagem").innerText')) && !(await evaluate(`document.querySelector('#lista').innerText.includes(${JSON.stringify(`${clientName} sem email`)})`)), await evaluate('document.querySelector("#mensagem").innerText'));

  await submitClient(clientName, 'Campinas', 'SP', clientEmail);
  await until(`document.querySelector('#lista')?.innerText.includes(${JSON.stringify(clientName)})`, 'cliente na lista');
  const row = await evaluate(`(() => { const li = [...document.querySelectorAll('#lista li')].find(li => li.innerText.includes(${JSON.stringify(clientName)})); return li ? li.innerText : null; })()`);
  check('Cliente aparece na lista com cidade e UF', row && /Campinas/.test(row) && /SP/.test(row), row);
  check('Formulario limpo apos cadastro', (await evaluate('document.querySelector("#cliente-nome").value + document.querySelector("#cliente-email").value')) === '');
  check('Mensagem de sucesso em regiao aria-live', await evaluate('(() => { const m = document.querySelector("#mensagem"); return m.getAttribute("aria-live") === "polite" && /cadastrado/i.test(m.innerText); })()'));
  check('Sucesso mostra o login criado e o aviso da senha padrao', await evaluate(`(() => { const t = document.querySelector('#mensagem').innerText; return t.includes(${JSON.stringify(clientEmail)}) && t.includes('senha padrão'); })()`), await evaluate('document.querySelector("#mensagem").innerText'));
  await shot('clientes-desktop');

  await submitClient(`${clientName} outra`, 'Campinas', 'SP', clientEmail);
  await until('/ja tem acesso/i.test(document.querySelector("#mensagem")?.innerText ?? "")', 'erro de e-mail ja usado');
  check('E-mail ja usado mostra o 409 da API e nao cadastra', await evaluate(`document.querySelector('#mensagem').classList.contains('erro') && !document.querySelector('#lista').innerText.includes(${JSON.stringify(`${clientName} outra`)})`));

  await submitClient(clientName.toUpperCase(), 'Campinas', 'SP', `qa.duplicado.${Date.now()}@cti.demo`);
  await until('/ja cadastrado|já cadastrado/i.test(document.querySelector("#mensagem")?.innerText ?? "")', 'erro de duplicado');
  check('Duplicado em caixa diferente mostra erro do servidor', await evaluate('document.querySelector("#mensagem").classList.contains("erro")'), await evaluate('document.querySelector("#mensagem").innerText'));
  check('Duplicado nao entra na lista', (await evaluate(`[...document.querySelectorAll('#lista li')].filter(li => li.innerText.toLowerCase().includes(${JSON.stringify(clientName.toLowerCase())})).length`)) === 1);

  await evaluate(`(() => { const b = document.querySelector('#busca'); b.value='campinas'; b.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await pause(200);
  check('Busca por cidade filtra a lista', await evaluate(`(() => { const items = [...document.querySelectorAll('#lista li')]; return items.length >= 1 && items.every(li => /campinas/i.test(li.innerText)); })()`));
  const noAccessName = `QA Sem Acesso ${Date.now()}`;
  const noAccess = await api('POST', '/api/clients', { name: noAccessName, city: 'Recife', state: 'PE' });
  await cdp('Page.navigate', { url: `${base}/clientes/` });
  await until(`!!(${card(noAccessName)})`, 'lista com a empresa sem acesso');
  check('Cartao mostra o e-mail de acesso ou o aviso de sem acesso', noAccess.status === 201 && await evaluate(`(${card(noAccessName)}).innerText.includes('Sem acesso à plataforma')`) && await evaluate(`(${card(clientName)}).innerText.includes(${JSON.stringify(clientEmail)}) && [...document.querySelectorAll('#lista li')].some(li => li.innerText.includes('Sem acesso à plataforma'))`));
  check('Atendente ve Editar em cada cartao e nenhum botao de remocao', await evaluate(`document.querySelectorAll('#lista li').length === document.querySelectorAll('#lista [data-acao="editar"]').length && !document.querySelector('#lista [data-acao="remover"]')`));
  await evaluate(`(${card(clientName)}).querySelector('[data-acao="editar"]').click()`);
  check('Editar carrega os dados no formulario de cima e troca titulo e botao', await evaluate(`document.querySelector('#cadastro-titulo').textContent === 'Editar cliente' && document.querySelector('#cliente-nome').value === ${JSON.stringify(clientName)} && document.querySelector('#cliente-email').value === ${JSON.stringify(clientEmail)} && document.querySelector('#cliente-cidade').value === 'Campinas' && document.querySelector('#cliente-uf').value === 'SP' && document.querySelector('#cadastrar').textContent === 'Salvar alterações' && !document.querySelector('#cancelar-edicao').hidden`));
  await evaluate(`document.querySelector('#cancelar-edicao').click()`);
  check('Cancelar volta ao cadastro com o formulario limpo', await evaluate(`document.querySelector('#cadastro-titulo').textContent === 'Novo cliente' && document.querySelector('#cliente-nome').value === '' && document.querySelector('#cancelar-edicao').hidden`));
  await evaluate(`(${card(clientName)}).querySelector('[data-acao="editar"]').click()`);
  await evaluate(`(() => { document.querySelector('#cliente-cidade').value = 'Sorocaba'; document.querySelector('#cadastro-form').requestSubmit(); })()`);
  await until(`(${card(clientName)})?.innerText.includes('Sorocaba')`, 'cidade editada no cartao');
  check('Salvar alteracoes grava a cidade nova e volta ao cadastro', await evaluate(`/atualizados/.test(document.querySelector('#mensagem').innerText) && document.querySelector('#cadastro-titulo').textContent === 'Novo cliente'`) && (await api('GET', '/api/bootstrap')).body.data.clients.find(c => c.name === clientName)?.city === 'Sorocaba');
  const semAcesso = (await api('GET', '/api/bootstrap')).body.data.clients.find(c => !c.login_email);
  if (semAcesso) {
    await evaluate(`(${card(semAcesso.name)}).querySelector('[data-acao="editar"]').click()`);
    check('Empresa sem acesso edita com o e-mail travado', await evaluate(`document.querySelector('#cliente-email').disabled && /não tem acesso/.test(document.querySelector('#cliente-email-dica').textContent)`));
    await evaluate(`document.querySelector('#cancelar-edicao').click()`);
  }

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

  await evaluate('document.querySelector("#sair").click()');
  await until('!document.querySelector("#login-view").hidden', 'logout antes da supervisora');
  await login('marina@cti.demo');
  await until('document.querySelector("#app-view") && !document.querySelector("#app-view").hidden && document.querySelectorAll("#lista li").length > 0', 'lista da supervisora');
  check('Supervisora ve Excluir ou Arquivar conforme o historico', await evaluate(`[...document.querySelectorAll('#lista li')].every(li => { const b = li.querySelector('[data-acao="remover"]'); return b && ['Excluir', 'Arquivar'].includes(b.textContent); })`));
  const deleteName = `QA Excluir ${Date.now()}`;
  await submitClient(deleteName, 'Recife', 'PE', `qa.excluir.${Date.now()}@cti.demo`);
  await until(`!!(${card(deleteName)})`, 'empresa para excluir na lista');
  const removeOf = name => `(${card(name)}).querySelector('[data-acao="remover"]')`;
  check('Empresa sem historico oferece Excluir', await evaluate(`${removeOf(deleteName)}.textContent === 'Excluir'`));
  await evaluate(`${removeOf(deleteName)}.click()`);
  check('Primeiro clique so pede confirmacao da exclusao', await evaluate(`${removeOf(deleteName)}.textContent === 'Confirmar exclusão'`));
  await evaluate(`${removeOf(deleteName)}.click()`);
  await until(`!(${card(deleteName)})`, 'empresa excluida some da lista');
  check('Segundo clique exclui a empresa sem historico', !(await api('GET', '/api/bootstrap')).body.data.clients.some(c => c.name === deleteName) && /excluído/.test(await evaluate('document.querySelector("#mensagem").innerText')));
  const archiveName = `QA Arquivar ${Date.now()}`;
  const archiveEmail = `qa.arquivar.${Date.now()}@cti.demo`;
  await submitClient(archiveName, 'Natal', 'RN', archiveEmail);
  await until(`!!(${card(archiveName)})`, 'empresa para arquivar na lista');
  const archiveId = (await api('GET', '/api/bootstrap')).body.data.clients.find(c => c.name === archiveName)?.id;
  await api('POST', '/api/logout');
  await api('POST', '/api/login', { email: 'rafael@cti.demo', password });
  const historyTicket = await api('POST', '/api/tickets', { client_id: archiveId, subject: 'Atendimento QA da empresa arquivada', channel: 'Portal', priority: 'low', status: 'resolved', solution: 'Solucao registrada para gerar historico da empresa.' });
  await api('POST', '/api/logout');
  await api('POST', '/api/login', { email: archiveEmail, password });
  const confirmed = await api('POST', '/api/feedbacks', { ticket_id: historyTicket.body?.data?.id, rating: 5, resolved: true, mode: 'quick' });
  await api('POST', '/api/logout');
  await api('POST', '/api/login', { email: 'marina@cti.demo', password });
  await cdp('Page.navigate', { url: `${base}/clientes/` });
  await until(`!!(${card(archiveName)})`, 'lista recarregada com a empresa que tem historico');
  check('Empresa com historico oferece Arquivar', historyTicket.status === 201 && confirmed.status === 201 && await evaluate(`${removeOf(archiveName)}.textContent === 'Arquivar'`), { ticket: historyTicket.status, feedback: confirmed.status });
  await evaluate(`${removeOf(archiveName)}.click()`);
  check('Primeiro clique so pede confirmacao do arquivamento', await evaluate(`${removeOf(archiveName)}.textContent === 'Confirmar arquivamento'`));
  await evaluate(`${removeOf(archiveName)}.click()`);
  await until(`!(${card(archiveName)})`, 'empresa arquivada some da lista');
  const afterArchive = (await api('GET', '/api/bootstrap')).body.data;
  check('Arquivar tira a empresa da lista e preserva o atendimento com o nome dela', !afterArchive.clients.some(c => c.id === archiveId) && afterArchive.tickets.find(t => t.id === historyTicket.body.data.id)?.client_name === archiveName);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(300);
  await shot('clientes-supervisor-1280');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  const supervisorMobile = await evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth})');
  check('Mobile 390 sem rolagem horizontal (supervisora com acoes)', supervisorMobile.width <= supervisorMobile.viewport, supervisorMobile);
  await shot('clientes-supervisor-390');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  check('Login da empresa arquivada deixa de entrar', (await api('POST', '/api/login', { email: archiveEmail, password })).status === 401);

  await evaluate('document.querySelector("#sair").click()');
  await until('!document.querySelector("#login-view").hidden', 'logout da supervisora');
  await cdp('Page.navigate', { url: base });
  await until('!!document.querySelector("#login-form")', 'login da tela principal');
  await evaluate(`(() => { document.querySelector('#login-email').value=${JSON.stringify(clientEmail)};document.querySelector('#login-password').value=${JSON.stringify(password)};document.querySelector('#login-form').requestSubmit(); })()`);
  await until('!!document.querySelector("nav")', 'empresa nova entra na plataforma');
  check('Empresa nova entra no espaco do cliente com a senha padrao', await evaluate(`location.hash === '#enviar-feedback' && document.querySelector('.space-label')?.textContent.trim() === 'Espaço cliente'`), await evaluate(`({hash: location.hash, space: document.querySelector('.space-label')?.textContent})`));
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
