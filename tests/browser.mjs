import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.CTI_QA_OUT ?? path.join(root, 'storage', 'qa');
const profile = path.join(output, `browser-${Date.now()}`);
const base = process.env.CTI_BASE_URL ?? 'http://127.0.0.1:8095';
const executable = process.env.CTI_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
await mkdir(profile, { recursive: true });
const results = [];
const errors = [];
const pending = new Map();
let browser, socket, request = 0;
let workflowTicket = null;
const workflowSubject = `VPN QA navegador ${Date.now()}`;
const qaAttendantEmail = `qa.atendente.${Date.now()}@cti.demo`;
const qaSupervisorEmail = `qa.supervisor.${Date.now()}@cti.demo`;
const userRow = email => `[...document.querySelectorAll('#users-list tbody tr')].find(r => r.textContent.includes(${JSON.stringify(email)}))`;
async function toggleUser(email, id, action, expected) {
  await evaluate(`document.querySelector('#users-list [data-action="${action}"][data-id="${id}"]').click()`);
  await until(`(${userRow(email)})?.textContent.includes(${JSON.stringify(expected)})`, `${action} ${email}`);
}
async function createUser(name, email, teamId) {
  await evaluate(`(() => { const f = document.querySelector('#user-form'); f.querySelector('#user_name').value = ${JSON.stringify(name)}; f.querySelector('#user_email').value = ${JSON.stringify(email)}; ${teamId === undefined ? '' : `f.querySelector('#team_id').value = ${JSON.stringify(String(teamId))};`} f.requestSubmit(); })()`);
  await until(`document.querySelector('#toast').textContent.includes(${JSON.stringify(email)}) && !!(${userRow(email)})`, `conta criada ${email}`);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const visibleCols = `[...document.querySelectorAll('table')].map(t => [...t.querySelectorAll('thead th')].filter(th => th.offsetParent !== null && th.getBoundingClientRect().width > 0).length)`;
function check(name, condition, details) {
  results.push({ name, passed: Boolean(condition), details });
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
async function shot(name, width = 1440) {
  await evaluate('document.fonts.ready');
  const value = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(path.join(output, `${name}-${width}.png`), Buffer.from(value.data, 'base64'));
}
// Sessao propria no Node, com cookie e CSRF separados da aba do navegador.
async function nodeRequest(email, method, route, body) {
  let cookie = '';
  const call = async (verb, path, payload, token) => {
    const response = await fetch(base + path, { method: verb, headers: { Cookie: cookie, ...(token ? { 'X-CSRF-Token': token } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    const set = response.headers.getSetCookie().find(value => value.startsWith('cti_session='));
    if (set) cookie = set.split(';')[0];
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const session = await call('GET', '/api/session');
  const login = await call('POST', '/api/login', { email, password: 'CtiDemo2026!' }, session.body?.data?.csrf_token);
  return call(method, route, body, login.body?.data?.csrf_token);
}
async function api(method, route, body) {
  return evaluate(`(async () => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch(${JSON.stringify(route)}, {method:${JSON.stringify(method)},headers:{${body === undefined ? '' : "'Content-Type':'application/json',"}'X-CSRF-Token':session.data.csrf_token},${body === undefined ? '' : `body:JSON.stringify(${JSON.stringify(body)}),`}credentials:'same-origin'});
    const type = response.headers.get('Content-Type') ?? '';
    return {status:response.status,type,body:type.includes('json') ? await response.json() : await response.text()};
  })()`);
}

try {
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
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
    else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const entry = message.params.entry;
      const expectedAuthentication = (entry.url?.endsWith('/api/login') || entry.url?.endsWith('/api/bootstrap')) && entry.text.includes('401');
      const expectedConflict = entry.url?.endsWith('/api/clients') && entry.text.includes('409');
      if (!expectedAuthentication && !expectedConflict) errors.push({ type: 'log', details: entry });
    }
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Log.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base });
  await until('!!document.querySelector("form")', 'formulario de login');
  await shot('login');
  check('Login exibe logo branca sobre o azul', await evaluate(`!![...document.querySelectorAll('.login-hero img')].find(img => img.src.includes('cti-logo-branca.png') && img.complete && img.naturalWidth > 0)`));
  check('Login sem textos de projeto academico no rodape', await evaluate(`(() => { const text = document.body.innerText; return !text.includes('Projeto integrador') && !text.includes('SENAI 2026') && !text.includes('Plataforma acadêmica') && !!document.querySelector('#login-form'); })()`));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(200);
  const loginMobile = await evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth})');
  check('Login mobile 390 sem rolagem horizontal', loginMobile.width <= loginMobile.viewport, loginMobile);
  await shot('login-mobile', 390);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const denied = await api('POST', '/api/login', { email: 'rafael@cti.demo', password: 'invalida' });
  check('HTTP recusa senha incorreta', denied.status === 401);
  const cookies = (await cdp('Network.getCookies', { urls: [base] })).cookies;
  check('Cookie protege sessao', cookies.some(cookie => cookie.name === 'cti_session' && cookie.httpOnly && cookie.sameSite === 'Strict'));
  for (const [email, role] of [['rafael@cti.demo', 'attendant'], ['lucas@cti.demo', 'client'], ['marina@cti.demo', 'supervisor'], ['helena@cti.demo', 'manager']]) {
    await api('POST', '/api/logout');
    await cdp('Page.navigate', { url: base });
    await until('!!document.querySelector("#login-form")', `login ${role}`);
    await evaluate(`(() => { document.querySelector('#login-email').value=${JSON.stringify(email)};document.querySelector('#login-password').value='CtiDemo2026!';document.querySelector('#login-form').requestSubmit(); })()`);
    await until('!!document.querySelector("nav")', `menu ${role}`);
    await pause(300);
    const boot = await api('GET', '/api/bootstrap');
    check(`Sessao e banco ${role}`, boot.status === 200 && boot.body.data.user.role === role);
    const links = await evaluate(`[...document.querySelectorAll('nav a[href^="#"]')].map(a=>({href:a.getAttribute('href'),text:a.textContent.trim()}))`);
    check(`Navegacao ${role}`, links.length >= 2, links);
    for (const [index, link] of links.entries()) {
      await evaluate(`location.hash=${JSON.stringify(link.href)}`);
      await pause(350);
      const state = await evaluate(`({title:document.querySelector('h1')?.textContent,broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.getAttribute('src')),width:document.documentElement.scrollWidth,viewport:innerWidth})`);
      check(`Tela ${role}: ${link.text}`, Boolean(state.title) && state.broken.length === 0 && state.width <= state.viewport, state);
      await shot(`${role}-${index}`);
      check(`Tabelas com no maximo 4 colunas visiveis ${role}: ${link.text}`, (await evaluate(visibleCols)).every(n => n <= 4), await evaluate(visibleCols));
      check(`Sem concordancia IA x humano na tela ${role}: ${link.text}`, await evaluate(`!/concord/i.test(document.body.textContent) && !document.querySelector('.agreement-card')`));
    }
    const removedTexts = ['Ambiente acadêmico', 'Plataforma de experiência', 'Projeto SENAI', 'Conectividade / Segurança / Cloud'];
    check(`Textos removidos ausentes ${role}`, await evaluate(`(() => { const text = document.body.innerText; return ${JSON.stringify(removedTexts)}.every(item => !text.includes(item)); })()`));
    check(`Tema escuro so no gestor: ${role}`, (await evaluate(`!!document.querySelector('.theme-dash')`)) === (role === 'manager') && (role === 'manager' || await evaluate(`getComputedStyle(document.querySelector('.work-area')).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(document.querySelector('.card') || document.body).backgroundColor !== 'rgb(13, 33, 71)'`)));
    check(`Menu lateral com logo branca ${role}`, await evaluate(`!![...document.querySelectorAll('.sidebar img')].find(img => img.src.includes('cti-logo-branca.png') && img.complete && img.naturalWidth > 0)`));
    check(`Sino de alertas ${role}`, (await evaluate(`!!document.querySelector('[data-action="notifications"]')`)) === (role !== 'manager'));
    if (role === 'manager') check('Gestor nao ve alertas nem contador', await evaluate(`!document.querySelector('[data-action="notifications"]') && !document.querySelector('#notification-count') && !document.body.innerText.includes('Resposta vencida')`));
    if (role === 'client') {
      check('Cliente sem Meus atendimentos e com Enviar feedback como inicio', !links.some(link => link.href === '#atendimentos' || link.text.includes('Meus atendimentos')) && links[0].href === '#enviar-feedback', links);
    }
    if (role === 'attendant') {
      check('Atendente tem aba Clientes depois de Registrar atendimento', links.findIndex(link => link.href === '#clientes') === links.findIndex(link => link.href === '#registrar') + 1, links);
      await evaluate(`location.hash='#relatorio'`);
      await until(`document.body.innerText.includes('Prazos que precisam de atenção')`, 'prazos no relatorio do atendente');
      check('Meu relatorio do atendente sem botoes, previa e equipes, com texto de periodo', await evaluate(`!document.querySelector('.report-type') && !document.body.innerText.includes('Prévia do relatório') && !document.body.innerText.includes('Comparação resumida') && document.body.innerText.includes('data de abertura')`));
      const ownClients = [...new Set((await api('GET', '/api/bootstrap')).body.data.tickets.map(t => String(t.client_id)))];
      check('Filtro de cliente lista so empresas dos atendimentos do atendente', await evaluate(`[...document.querySelectorAll('#client_id option')].map(o => o.value).filter(Boolean).every(v => ${JSON.stringify(ownClients)}.includes(v))`));
      await shot('atendente-meu-relatorio');
    }
    if (role !== 'client') {
      const report = await api('GET', '/api/reports');
      check(`Relatorio real ${role}`, report.status === 200 && typeof report.body.data.total_tickets === 'number');
      const csv = await api('GET', '/api/reports/export');
      check(`CSV ${role}`, csv.status === 200 && csv.type.includes('text/csv') && typeof csv.body === 'string' && csv.body.length > 30);
    }
    if (role === 'attendant') {
      await evaluate(`location.hash='#clientes'`);
      await until(`!!document.querySelector('#client-search')`, 'aba Clientes');
      const clientsApi = (await api('GET', '/api/bootstrap')).body.data.clients;
      check('Aba Clientes e somente consulta: sem formulario nem campo de novo cliente', await evaluate(`!document.querySelector('#client-form') && !document.querySelector('#page-content form') && !document.querySelector('#name') && !/Cadastrar empresa/.test(document.body.textContent)`));
      check('Aba Clientes orienta o cadastro com link /clientes/ em nova aba', await evaluate(`(() => { const a = document.querySelector('#page-content a[href="/clientes/"]'); return Boolean(a) && a.target === '_blank' && a.rel.includes('noopener'); })()`));
      check('Aba Clientes lista as empresas com Cidade/UF', await evaluate(`(() => { const rows = [...document.querySelectorAll('#clients-list tbody tr')]; return rows.length === ${clientsApi.length} && rows.every(r => /\\/[A-Z]{2}/.test(r.cells[1].textContent)); })()`), clientsApi.length);
      const probe = clientsApi[0].name.slice(0, 6);
      await evaluate(`(() => { const i = document.querySelector('#client-search'); i.value = ${JSON.stringify(probe)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      check('Busca da aba Clientes filtra a lista', await evaluate(`(() => { const rows = [...document.querySelectorAll('#clients-list tbody tr')]; return rows.length >= 1 && rows.length <= ${clientsApi.length} && rows.every(r => r.textContent.toLowerCase().includes(${JSON.stringify(probe.toLowerCase())})); })()`));
      await evaluate(`(() => { const i = document.querySelector('#client-search'); i.value = 'zzzz-inexistente'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      check('Busca sem resultado informa que nada foi encontrado', await evaluate(`document.querySelector('#clients-list').textContent.includes('Nenhuma empresa encontrada')`));
      await evaluate(`(() => { const i = document.querySelector('#client-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await shot('atendente-clientes');
      await evaluate(`location.hash='#registrar'`);
      await until(`!!document.querySelector('#status')`, 'formulario de registro com status');
      check('Registro continua listando as empresas cadastradas', await evaluate(`[...document.querySelectorAll('#client_id option')].map(o => o.textContent).filter(Boolean).slice(1).join('|') === ${JSON.stringify(clientsApi.map(c => c.name).join('|'))}`));
      check('Registro tem select Prioridade (Baixa, Media, Alta, Critica) e nenhum campo de data', await evaluate(`(() => { const s = document.querySelector('#priority'); const form = document.querySelector('#ticket-form'); return s?.tagName === 'SELECT' && [...s.options].map(o => o.textContent).join('|') === 'Baixa|Média|Alta|Crítica' && document.querySelector('label[for="priority"]').textContent === 'Prioridade' && !form.querySelector('input[type="date"], input[type="datetime-local"], #response_due_at'); })()`));
      const hints = [];
      for (const [value, prazo] of [['low', '8h'], ['medium', '4h'], ['high', '1h'], ['critical', '30min']]) {
        await evaluate(`(() => { const s = document.querySelector('#priority'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        hints.push(await evaluate(`document.querySelector('#priority-hint').textContent.includes(${JSON.stringify(prazo)})`));
      }
      check('Texto auxiliar da prioridade mostra o prazo (8h, 4h, 1h, 30min)', hints.every(Boolean), hints);
      await evaluate(`(() => { const s = document.querySelector('#priority'); s.value = 'medium'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      check('Registro oferece Status com Em atendimento e Resolvido, solucao oculta', await evaluate(`[...document.querySelectorAll('#status option')].map(o => o.textContent).join('|') === 'Em atendimento|Resolvido' && document.querySelector('#create-solution').hidden`));
      await evaluate(`document.querySelector('#status').value='resolved';document.querySelector('#status').dispatchEvent(new Event('change',{bubbles:true}))`);
      check('Escolher Resolvido mostra a solucao obrigatoria e o aviso', await evaluate(`!document.querySelector('#create-solution').hidden && document.querySelector('#solution').required && !document.querySelector('#solution').disabled && document.querySelector('#create-solution').textContent.includes('não poderá ser repetida')`));
      const resolvedSubject = `Resolvido no registro QA ${Date.now()}`;
      await evaluate(`document.querySelector('#subject').value=${JSON.stringify(resolvedSubject)};document.querySelector('#client_id').value='1';document.querySelector('#solution').value='Reinicio do servico e validacao feita junto ao cliente.';document.querySelector('#ticket-form').requestSubmit()`);
      await until(`!!document.querySelector('.badge.awaiting_feedback')`, 'atendimento nasce aguardando confirmacao');
      const created = (await api('GET', '/api/bootstrap')).body.data.tickets.find(t => t.subject === resolvedSubject);
      check('Registro Resolvido nasce aguardando confirmacao e consome a unica mudanca', created?.status === 'awaiting_feedback' && created.manual_status_changes === 1 && created.solution.includes('Reinicio'), created && { status: created.status, manual: created.manual_status_changes });
      check('Tela de atualizacao informa que a atualizacao ja foi utilizada', await evaluate(`document.querySelector('.status-quota')?.textContent.includes('já utilizada') && !document.querySelector('#solution-form')`));
      await evaluate(`location.hash='#atendimentos'`);
      await until(`!!document.querySelector('.status-link')`, 'status clicavel');
      check('Lista do atendente tem status clicavel para atualizar', await evaluate(`document.querySelector('.status-link').textContent.includes('clique para atualizar') && document.querySelector('.status-link').getAttribute('href').startsWith('#registrar?id=')`));
      check('Lista do atendente mostra selos de nivel e prioridade do atendimento criado', await evaluate(`(() => { const row = [...document.querySelectorAll('.data-table tbody tr')].find(r => r.textContent.includes(${JSON.stringify(resolvedSubject)})); return Boolean(row) && row.querySelector('.badge.level')?.textContent.trim() === 'N1' && row.querySelector('.badge.prio')?.textContent.trim() === 'Média'; })()`));
      await evaluate(`location.hash='#registrar'`);
      await until(`!!document.querySelector('#ticket-form')`);
      await evaluate(`document.querySelector('#subject').value='VPN';document.querySelector('#subject').dispatchEvent(new Event('input',{bubbles:true}))`);
      await until(`!!document.querySelector('#subject-suggestions [role="option"]')`, 'autocomplete no banco');
      check('Autocomplete apresenta solucao do banco', await evaluate(`document.querySelector('#subject-suggestions').textContent.length > 20 && document.querySelector('#related-cases').textContent.includes('VPN')`));
      await evaluate(`document.querySelector('#subject-suggestions [role="option"]').click();document.querySelector('#subject').value=${JSON.stringify(workflowSubject)};document.querySelector('#client_id').value='1';document.querySelector('#ticket-form').requestSubmit()`);
      await until(`!!document.querySelector('#ticket-form')?.dataset.id`, 'registro persistido');
      workflowTicket = Number(await evaluate(`document.querySelector('#ticket-form').dataset.id`));
      check('Registrar abre edicao na mesma pagina', workflowTicket > 0 && await evaluate(`location.hash.startsWith('#registrar?id=') && !document.querySelector('dialog[open]')`));
      await evaluate(`document.querySelector('#subject').value=${JSON.stringify(workflowSubject + ' revisado')};document.querySelector('#ticket-form').requestSubmit()`);
      await until(`document.querySelector('#toast').textContent.includes('atualizadas')`, 'edicao salva');
      const edited = await api('GET', '/api/bootstrap');
      check('Formulario edita atendimento no banco', edited.body.data.tickets.find(t => t.id === workflowTicket)?.subject === workflowSubject + ' revisado');
      await evaluate(`window.__qaForm=document.querySelector('#ticket-form');document.querySelector('#subject').value='Rascunho ainda nao salvo'`);
      await evaluate(`window.__qaFetch=window.fetch;window.fetch=async (...args)=>{const response=await window.__qaFetch(...args);if(args[0]==='/api/bootstrap'){const data=await response.json();data.data.notifications.push({title:'Resposta atrasada',message:'Lembrete de teste.',ticket_id:${workflowTicket},due_at:new Date(Date.now()-3600000).toISOString(),type:'response'});return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});}return response;};document.dispatchEvent(new Event('visibilitychange'))`);
      await until(`document.querySelector('#toast').textContent.includes('Há novos lembretes')`, 'lembrete atualizado sem navegar');
      await evaluate(`window.fetch=window.__qaFetch;delete window.__qaFetch`);
      check('Lembrete atualiza preservando digitacao e formulario', await evaluate(`document.querySelector('#ticket-form')===window.__qaForm && document.querySelector('#subject').value==='Rascunho ainda nao salvo'`));
      const alerts = (await api('GET', '/api/bootstrap')).body.data.notifications.length;
      check('Contador de alertas acompanha o polling sem recarregar', await evaluate(`Number(document.querySelector('#notification-count').textContent)===${alerts + 1}`));
      await evaluate(`document.querySelector('#message').value='Estamos validando a conexao VPN. Retornaremos no prazo informado.';document.querySelector('#reply-form').requestSubmit()`);
      await until(`document.querySelector('#toast').textContent.includes('Resposta registrada')`);
      await evaluate(`document.querySelector('#solution').value='Credenciais VPN renovadas e rotas validadas com teste de conexao.';document.querySelector('#solution-form').requestSubmit()`);
      await until(`!document.querySelector('#solution-form') && document.querySelector('.badge.awaiting_feedback')`, 'solucao aguardando confirmacao');
      const solved = (await api('GET', '/api/bootstrap')).body.data.tickets.find(t => t.id === workflowTicket);
      check('UI envia solucao apenas uma vez sem encerrar', solved.status === 'awaiting_feedback' && solved.manual_status_changes === 1);
      check('Atualizacao so oferece o envio da solucao, sem seletor de status', await evaluate(`!document.querySelector('select[name="status"]') && document.querySelector('.status-quota')?.textContent.includes('já utilizada')`));
      await shot('atendimento-criado');
      await evaluate(`location.hash='#pagina-inexistente'`);
      await until(`document.querySelector('h1')?.textContent.includes('Não encontramos esta página.')`, 'pagina 404');
      check('Pagina inexistente oferece retorno ao espaco do perfil', await evaluate(`!!document.querySelector('.standalone-error a[href="#atendimentos"]')`));
      check('Pagina 404 usa a logo colorida sobre fundo claro', await evaluate(`!![...document.querySelectorAll('.standalone-error img')].find(img => img.src.includes('cti-oficial.png') && img.complete && img.naturalWidth > 0)`));
      await shot('pagina-404');
      await evaluate(`document.querySelector('.standalone-error a').click()`);
      await until(`!!document.querySelector('nav')`, 'retorno da pagina 404');
    }
    if (role === 'client') {
      await evaluate(`location.hash='#enviar-feedback'`);
      await until(`!!document.querySelector('.ticket-card[data-ticket="${workflowTicket}"] [data-action="decide"]')`, 'cartao do atendimento com botoes de decisao');
      check('Cartao do cliente mostra protocolo, solucao e os dois botoes', await evaluate(`(() => { const card = document.querySelector('.ticket-card[data-ticket="${workflowTicket}"]'); const labels = [...card.querySelectorAll('[data-action="decide"]')].map(b => b.textContent.trim()); return card.textContent.includes('Solução enviada pela equipe') && card.textContent.includes('Credenciais VPN renovadas') && card.textContent.includes('Atendente:') && card.textContent.includes('Confirmação até') && labels.join('|') === 'Resolveu, pode encerrar|Ainda preciso de ajuda'; })()`));
      check('Cliente nao tem formulario rapido nem select de resolucao antes da decisao', await evaluate(`!document.querySelector('form[data-form="quick-feedback"]') && !document.querySelector('select[name="resolved"]') && !document.querySelector('#feedback-form')`));
      await shot('cliente-decisao');
      await evaluate(`document.querySelector('[data-action="decide"][data-id="${workflowTicket}"][data-resolved="0"]').click()`);
      await until(`!!document.querySelector('#feedback-text')`, 'formulario com a decisao fixada');
      check('Decisao fixada em campo oculto, sem select', await evaluate(`document.querySelector('#feedback-form input[type="hidden"][name="resolved"]').value === '0' && !document.querySelector('#feedback-form select')`));
      await evaluate(`document.querySelector('#feedback-text').value='Ainda preciso de ajuda';document.querySelector('#feedback-text').dispatchEvent(new Event('input',{bubbles:true}))`);
      check('Texto bloqueia gravacao concorrente', await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="audio"]').disabled`));
      await evaluate(`document.querySelector('[data-action="clear-feedback"]').click()`);
      check('Limpar libera troca de formato', await evaluate(`!document.querySelector('[data-action="feedback-mode"][data-mode="audio"]').disabled`));
      await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="audio"]').click()`);
      check('Aba de audio vazia abre o painel de gravacao', await evaluate(`!!document.querySelector('#recording-panel') && !document.querySelector('#feedback-text')`));
      await evaluate(`document.querySelector('[data-action="clear-feedback"]').click()`);
      check('Descartar com audio vazio volta ao texto e libera o envio so com a nota', await evaluate(`!!document.querySelector('#feedback-text') && !document.querySelector('#recording-panel') && document.querySelector('[data-action="feedback-mode"][data-mode="text"]').getAttribute('aria-pressed') === 'true'`));
      await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="audio"]').click();document.querySelector('#record-start').click()`);
      await until(`document.querySelector('#record-stop') && !document.querySelector('#record-stop').hidden`, 'microfone sintetico iniciado');
      await pause(1300);
      check('Gravacao bloqueia texto concorrente', await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="text"]').disabled`));
      await evaluate(`document.querySelector('#record-stop').click()`);
      await until(`!!document.querySelector('#audio-preview audio')`, 'WAV gravado pelo navegador');
      await until(`document.querySelector('#audio-preview audio').readyState >= 1`, 'preview de audio decodificado');
      const wave = await evaluate(`({duration:document.querySelector('#audio-preview audio').duration,blob:document.querySelector('#audio-preview audio').src.startsWith('blob:')})`);
      check('Navegador reproduz WAV com microfone sintetico', wave.blob && wave.duration > 0 && wave.duration <= 60, wave);
      check('Gravacao bloqueia anexo concorrente', await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="upload"]')?.disabled === true`));
      await evaluate(`document.querySelector('[data-action="clear-feedback"]').click()`);
      check('Formulario oferece exatamente tres formatos', await evaluate(`[...document.querySelectorAll('[data-action="feedback-mode"]')].map(b => b.dataset.mode + ':' + b.textContent.trim()).join('|') === 'text:Escrever|audio:Gravar áudio|upload:Anexar áudio'`));
      await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="upload"]').click()`);
      check('Aba de anexo abre seletor de arquivo de audio sem gravador nem texto', await evaluate(`(() => { const input = document.querySelector('#feedback-file'); return !!input && input.type === 'file' && input.accept === 'audio/*' && !document.querySelector('#feedback-text') && !document.querySelector('#record-start'); })()`));
      const attach = file => evaluate(`(async () => { const file = await ${file}; const input = document.querySelector('#feedback-file'); const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      const qaWav = seconds => `(() => { const rate = 8000, n = rate * ${seconds}; const view = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0))); w(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 8000), true); return new File([view], 'longo.wav', { type: 'audio/wav' }); })()`;
      const qaWebm = `(async () => { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start(); const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' }); const parts = []; rec.ondataavailable = e => parts.push(e.data); const done = new Promise(r => { rec.onstop = r; }); rec.start(); await new Promise(r => setTimeout(r, 1500)); rec.stop(); await done; osc.stop(); await ctx.close(); return new File(parts, 'mensagem.webm', { type: 'audio/webm' }); })()`;
      await attach(qaWav(61));
      await until(`document.querySelector('.toast')?.textContent.includes('mais de 60 segundos')`, 'recusa de anexo acima de 60 segundos');
      check('Anexo acima de 60 segundos e recusado sem ocupar o formulario', await evaluate(`!document.querySelector('#audio-preview audio') && !document.querySelector('[data-action="feedback-mode"][data-mode="text"]').disabled && document.querySelector('#feedback-file').value === ''`));
      await attach(qaWebm);
      await until(`!!document.querySelector('#audio-preview audio')`, 'anexo WebM convertido');
      await until(`document.querySelector('#audio-preview audio').readyState >= 1`, 'preview do anexo decodificado');
      const preview = await evaluate(`document.querySelector('#audio-preview audio').duration`);
      check('Preview do anexo tem a duracao do arquivo', preview > 1 && preview < 3, preview);
      check('Anexo bloqueia texto e gravacao concorrentes', await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="text"]').disabled && document.querySelector('[data-action="feedback-mode"][data-mode="audio"]').disabled`));
      await evaluate(`document.querySelector('#feedback-form input[name="rating"][value="1"]').checked=true;document.querySelector('#feedback-form input[name="confirmed"]').checked=true;document.querySelector('#feedback-form').requestSubmit()`);
      await until(`document.querySelector('.success-card')?.textContent.includes('ainda precisa de ajuda')`, 'envio da decisao negativa');
      const afterAttach = (await api('GET', '/api/bootstrap')).body.data;
      const rejected = afterAttach.tickets.find(t => t.id === workflowTicket);
      check('Decisao negativa por botao mantem atendimento aberto', rejected.status === 'active' && rejected.manual_status_changes === 1);
      const attached = afterAttach.feedbacks.find(f => f.ticket_id === workflowTicket && f.mode === 'audio');
      check('Audio anexado chega ao servidor como feedback de audio', Boolean(attached?.audio_url), afterAttach.feedbacks.filter(f => f.ticket_id === workflowTicket).map(f => f.mode));
      const stored = await evaluate(`(async () => { const response = await fetch(${JSON.stringify(attached?.audio_url ?? '')}); const head = new Uint8Array(await (await response.blob()).slice(0, 44).arrayBuffer()); const view = new DataView(head.buffer); return { status: response.status, tag: String.fromCharCode(...head.slice(0, 4)) + String.fromCharCode(...head.slice(8, 12)), format: view.getUint16(20, true), channels: view.getUint16(22, true), rate: view.getUint32(24, true), bits: view.getUint16(34, true) }; })()`);
      check('Anexo WebM foi convertido em WAV PCM mono 16 bits a 16 kHz', stored.status === 200 && stored.tag === 'RIFFWAVE' && stored.format === 1 && stored.channels === 1 && stored.bits === 16 && stored.rate === 16000, stored);
      check('Pos-envio do cliente nao aponta para Meus atendimentos', await evaluate(`!document.body.innerText.includes('Meus atendimentos')`));
      await shot('cliente-feedback-negativo');
    }
    if (role === 'supervisor') {
      const fresh = (await api('GET', '/api/bootstrap')).body.data;
      const queueProtocol = fresh.tickets.find(t => t.id === workflowTicket)?.protocol;
      await evaluate(`location.hash='#dashboard'`);
      await until(`document.body.innerText.includes('Casos para tratar')`, 'fila de intervencao do supervisor');
      check('Dashboard do supervisor sem prazos, sem conexoes entre equipes e sem resposta vencida', await evaluate(`!['Prazos que precisam de atenção', 'Conexões entre equipes', 'Resposta vencida'].some(item => document.body.innerText.includes(item))`));
      check('Dashboard do supervisor abre com tres cartoes de intervencao antes da tabela e dos graficos', await evaluate(`(() => { const labels = [...document.querySelectorAll('.stat-label')].map(el => el.textContent.trim()); const table = document.querySelector('#report-results .data-table, #report-results .empty'); const chart = document.querySelector('#report-results .chart-card'); const cards = document.querySelector('.stats'); return labels.join('|') === 'Críticos sem revisão|Análises com falha|Cliente não resolveu' && Boolean(cards.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) && Boolean(table.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING); })()`));
      check('Fila mostra o atendimento que o cliente nao resolveu', await evaluate(`[...document.querySelectorAll('#report-results .data-table tbody tr')].some(row => row.textContent.includes(${JSON.stringify(queueProtocol)}) && row.textContent.includes('Não resolvido'))`), { protocol: queueProtocol, rows: await evaluate(`[...document.querySelectorAll('#report-results .data-table tbody tr')].map(row => row.textContent.replace(/\\s+/g, ' ').trim())`), rejected: fresh.tickets.filter(t => t.rejected_at).length });
      const supervisorReport = (await api('GET', '/api/reports')).body.data;
      check('Dashboard do supervisor sem concordancia IA x humano e com secoes secundarias em accordion', await evaluate(`!/concord/i.test(document.body.textContent) && document.querySelectorAll('#report-results details.acc').length >= 2`) && supervisorReport.agreement === undefined);
      await shot('supervisor-fila');
      await evaluate(`location.hash='#atendimentos'`);
      await until(`!!document.querySelector('.data-table')`, 'atendimentos da equipe');
      check('Atendimentos do supervisor sem lembretes de resposta', await evaluate(`!document.querySelector('.attention-list') && !document.body.innerText.includes('Resposta vencida') && !document.body.innerText.includes('Responder até')`));
      const levelsApi = [...new Set(fresh.tickets.map(t => `N${t.support_level}`))].sort();
      check('Atendimentos do supervisor mostram selos de nivel e de prioridade', await evaluate(`(() => { const lv = [...new Set([...document.querySelectorAll('.data-table .badge.level')].map(b => b.textContent.trim()))].sort(); return lv.length > 0 && JSON.stringify(lv) === '${JSON.stringify(levelsApi)}' && document.querySelectorAll('.data-table .badge.prio').length > 0; })()`), levelsApi);
      check('Dados de demonstracao cobrem os selos N1, N2 e N3', levelsApi.join(',') === 'N1,N2,N3', levelsApi);
      const levelBefore = fresh.tickets.find(t => t.id === workflowTicket).support_level;
      await evaluate(`document.querySelector('[data-action="ticket-detail"][data-id="${workflowTicket}"]').click()`);
      await until(`!!document.querySelector('#escalate-form')`, 'acao Escalar no detalhe');
      check('Supervisor ve Escalar com niveis maiores que o atual e a localizacao do cliente', await evaluate(`(() => { const f = document.querySelector('#escalate-form'); const opts = [...f.querySelectorAll('option')].map(o => Number(o.value)); return opts.length > 0 && opts.every(v => v > ${levelBefore}) && f.querySelector('button').textContent.trim() === 'Escalar' && /\\/[A-Z]{2}/.test(document.querySelector('dialog .description-list').textContent); })()`));
      await evaluate(`(() => { const f = document.querySelector('#escalate-form'); f.querySelector('select').value = '3'; f.requestSubmit(); })()`);
      await until(`document.querySelector('#toast').textContent.includes('escalado')`, 'escalonamento concluido');
      const escalated = (await api('GET', '/api/bootstrap')).body.data.tickets.find(t => t.id === workflowTicket);
      check('Escalar eleva o nivel no banco e o detalhe mostra N3', escalated.support_level === 3 && await evaluate(`document.querySelector('dialog .badge.level')?.textContent.trim() === 'N3' && !document.querySelector('#escalate-form')`), escalated.support_level);
      await shot('supervisor-escalado');
      await evaluate(`document.querySelector('dialog [data-action="modal-close"]').click()`);
      const feedback = fresh.feedbacks.find(f => f.ticket_id === workflowTicket);
      await evaluate(`location.hash='#feedbacks'`);
      await until(`!!document.querySelector('[data-action="feedback-detail"][data-id="${feedback.id}"]')`);
      check('Feedbacks da equipe explica a origem dos dados', await evaluate(`document.querySelector('#page-content .banner')?.textContent.includes('sentimento vem do modelo local ou da revisão humana')`));
      await evaluate(`document.querySelector('[data-action="feedback-detail"][data-id="${feedback.id}"]').click()`);
      await until(`!!document.querySelector('#review-form') && !!document.querySelector('#modal-cases .case-card')`, 'revisao com cases de resolucao');
      check('Modal supervisor oferece case real de solucao', await evaluate(`document.querySelector('#modal-cases').textContent.includes('VPN')`));
      check('Modal separa analise original da revisao humana', await evaluate(`document.querySelector('#feedback-analysis')?.textContent.includes('Análise automática original')`));
      await evaluate(`window.__qaReviewForm=document.querySelector('#review-form');document.querySelector('#justification').value='Rascunho de revisao que precisa ser preservado.';window.__qaFetch=window.fetch;window.__qaAnalysisPoll=false;window.fetch=async (...args)=>{const response=await window.__qaFetch(...args);if(args[0]==='/api/bootstrap'){const data=await response.json();const feedback=data.data.feedbacks.find(f=>f.id===${feedback.id});Object.assign(feedback,{analysis_status:'completed',analysis_source:'local_model',transcript:'A conexao permanece indisponivel.',original_sentiment:'negative',original_criticality:'critical',original_summary:'A conexao permanece indisponivel.',confidence:0.91,model:'modelo-de-teste',topics:['Conectividade'],evidence:['permanece indisponivel']});window.__qaAnalysisPoll=true;return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});}return response;};document.dispatchEvent(new Event('visibilitychange'))`);
      await until('window.__qaAnalysisPoll', 'resposta de analise atualizada');
      await pause(200);
      check('Resultado da analise atualiza modal sem perder rascunho da revisao', await evaluate(`document.querySelector('#review-form')===window.__qaReviewForm && document.querySelector('#justification').value==='Rascunho de revisao que precisa ser preservado.' && document.querySelector('#feedback-analysis')?.textContent.includes('91%') && document.querySelector('#feedback-transcript')?.textContent.includes('A conexao permanece indisponivel.')`));
      await evaluate(`window.fetch=window.__qaFetch;delete window.__qaFetch;delete window.__qaReviewForm;delete window.__qaAnalysisPoll`);
      await evaluate(`document.querySelector('#justification').value='Cliente informou que a conexao permanece indisponivel.';document.querySelector('#action').value='Revisar o tunel VPN e a rota entre matriz e filial.';document.querySelector('#review-form').requestSubmit()`);
      await until(`document.querySelector('.review-entry')?.textContent.includes('Cliente informou')`, 'historico de revisao');
      check('Revisao humana aparece no historico', true);
      await shot('supervisor-revisao');
      await evaluate(`document.querySelector('#retry_solution').value='Rota da VPN corrigida e conectividade testada entre as unidades.';document.querySelector('#retry_justification').value='A primeira tentativa nao corrigiu a rota de retorno.';document.querySelector('#retry-form').requestSubmit()`);
      await until(`!document.querySelector('dialog[open]')`, 'supervisor libera nova tentativa');
      const retry = (await api('GET', '/api/bootstrap')).body.data.tickets.find(t => t.id === workflowTicket);
      check('Nova tentativa supervisor preserva limite manual', retry.status === 'awaiting_feedback' && retry.manual_status_changes === 1 && retry.solution_attempt === 2);
      check('Supervisor tem a aba Equipe no fim do menu', links.at(-1)?.href === '#equipe', links);
      await evaluate(`location.hash='#equipe'`);
      await until(`!!document.querySelector('#user-form') && !!document.querySelector('#users-list .data-table')`, 'aba Equipe do supervisor');
      check('Equipe do supervisor: h1, formulario so com nome e e-mail e aviso da senha padrao', await evaluate(`document.querySelector('h1')?.textContent.includes('Equipe') && !!document.querySelector('#user_name') && document.querySelector('#user_email')?.type === 'email' && !document.querySelector('#user-form #team_id') && document.querySelector('#page-content').textContent.includes('senha padrão das contas de demonstração')`));
      await createUser('Atendente QA Navegador', qaAttendantEmail);
      check('Cadastro do atendente confirma a conta e a senha padrao', await evaluate(`document.querySelector('#toast').textContent === ${JSON.stringify(`Conta criada para ${qaAttendantEmail}. Entra com a senha padrão das contas de demonstração.`)}`), await evaluate(`document.querySelector('#toast').textContent`));
      const newAttendant = (await api('GET', '/api/users')).body.data.find(u => u.email === qaAttendantEmail);
      check('Atendente novo gravado ativo na equipe da supervisora', Number(newAttendant?.active) === 1, newAttendant);
      check('Atendente novo aparece Ativo com botao Desativar', await evaluate(`(() => { const r = ${userRow(qaAttendantEmail)}; return Boolean(r) && r.textContent.includes('Ativo') && r.querySelector('[data-action="user-deactivate"]')?.textContent.trim() === 'Desativar'; })()`));
      check('Lista da equipe nao oferece acao sobre a propria conta', await evaluate(`!document.querySelector('#users-list [data-id="${boot.body.data.user.id}"]')`));
      await toggleUser(qaAttendantEmail, newAttendant.id, 'user-deactivate', 'Inativo');
      check('Desativar atendente grava inativo e oferece Reativar', Number((await api('GET', '/api/users')).body.data.find(u => u.id === newAttendant.id)?.active) === 0 && await evaluate(`(${userRow(qaAttendantEmail)}).querySelector('[data-action="user-reactivate"]')?.textContent.trim() === 'Reativar'`));
      await toggleUser(qaAttendantEmail, newAttendant.id, 'user-reactivate', 'Ativo');
      check('Reativar atendente grava ativo de novo', Number((await api('GET', '/api/users')).body.data.find(u => u.id === newAttendant.id)?.active) === 1);
      const userForm = `document.querySelector('#user-form')`;
      await evaluate(`(${userRow(qaAttendantEmail)}).querySelector('[data-action="user-edit"]').click()`);
      check('Editar carrega nome e e-mail no formulario de cima e troca titulo e botao', await evaluate(`(() => { const f = ${userForm}; return f.closest('.form-card').querySelector('h2').textContent === 'Editar atendente' && f.querySelector('#user_name').value === 'Atendente QA Navegador' && f.querySelector('#user_email').value === ${JSON.stringify(qaAttendantEmail)} && f.querySelector('button[type="submit"]').textContent === 'Salvar alterações' && !f.querySelector('[data-action="user-edit-cancel"]').hidden; })()`));
      await shot('supervisor-equipe-edicao');
      await evaluate(`document.querySelector('[data-action="user-edit-cancel"]').click()`);
      check('Cancelar volta ao modo de criacao com o formulario limpo', await evaluate(`(() => { const f = ${userForm}; return f.closest('.form-card').querySelector('h2').textContent === 'Novo atendente' && f.querySelector('#user_name').value === '' && !f.dataset.id && f.querySelector('[data-action="user-edit-cancel"]').hidden && f.querySelector('button[type="submit"]').textContent === 'Criar conta'; })()`));
      await evaluate(`(${userRow(qaAttendantEmail)}).querySelector('[data-action="user-edit"]').click()`);
      await evaluate(`(() => { const f = ${userForm}; f.querySelector('#user_name').value = 'Atendente QA Editado'; f.requestSubmit(); })()`);
      await until(`(${userRow(qaAttendantEmail)})?.textContent.includes('Atendente QA Editado')`, 'atendente editado');
      check('Salvar alteracoes grava o nome novo e volta ao modo de criacao', (await api('GET', '/api/users')).body.data.find(u => u.id === newAttendant.id)?.name === 'Atendente QA Editado' && await evaluate(`${userForm}.querySelector('button[type="submit"]').textContent === 'Criar conta' && !${userForm}.dataset.id`));
      const qaDeleteEmail = `qa.excluir.${Date.now()}@cti.demo`;
      await createUser('Atendente QA Excluir', qaDeleteEmail);
      const deleteId = (await api('GET', '/api/users')).body.data.find(u => u.email === qaDeleteEmail)?.id;
      const removeButton = email => `(${userRow(email)}).querySelector('[data-action="user-remove"]')`;
      check('Conta sem historico oferece Excluir', await evaluate(`${removeButton(qaDeleteEmail)}.textContent.trim() === 'Excluir'`));
      await evaluate(`${removeButton(qaDeleteEmail)}.click()`);
      check('Primeiro clique em Excluir so pede confirmacao', await evaluate(`${removeButton(qaDeleteEmail)}.textContent.trim() === 'Confirmar exclusão'`) && (await api('GET', '/api/users')).body.data.some(u => u.id === deleteId));
      await pause(5300);
      check('Confirmacao volta ao texto original depois de 5 segundos', await evaluate(`${removeButton(qaDeleteEmail)}.textContent.trim() === 'Excluir'`));
      await evaluate(`${removeButton(qaDeleteEmail)}.click()`);
      await evaluate(`${removeButton(qaDeleteEmail)}.click()`);
      await until(`!(${userRow(qaDeleteEmail)})`, 'conta excluida some da lista');
      check('Segundo clique exclui a conta sem historico', !(await api('GET', '/api/users')).body.data.some(u => u.id === deleteId) && await evaluate(`document.querySelector('#toast').textContent.includes('excluída')`));
      const qaArchiveEmail = `qa.arquivar.${Date.now()}@cti.demo`;
      await createUser('Atendente QA Arquivar', qaArchiveEmail);
      const archiveId = (await api('GET', '/api/users')).body.data.find(u => u.email === qaArchiveEmail)?.id;
      const archivedTicket = await nodeRequest(qaArchiveEmail, 'POST', '/api/tickets', { client_id: 1, subject: 'Atendimento QA do atendente arquivado', channel: 'Portal', priority: 'low', status: 'resolved', solution: 'Solucao registrada pelo atendente que sera arquivado.' });
      await evaluate('location.reload()');
      await until(`!!document.querySelector('#users-list .data-table') && !!(${userRow(qaArchiveEmail)})`, 'equipe recarregada com a conta que tem historico');
      check('Conta com historico oferece Arquivar', archivedTicket.status === 201 && await evaluate(`${removeButton(qaArchiveEmail)}.textContent.trim() === 'Arquivar'`), archivedTicket.status);
      await toggleUser(qaArchiveEmail, archiveId, 'user-deactivate', 'Inativo');
      check('Desativar conta com historico mantem o botao Arquivar', await evaluate(`${removeButton(qaArchiveEmail)}.textContent.trim() === 'Arquivar'`));
      await toggleUser(qaArchiveEmail, archiveId, 'user-reactivate', 'Ativo');
      await evaluate(`${removeButton(qaArchiveEmail)}.click()`);
      check('Primeiro clique em Arquivar so pede confirmacao', await evaluate(`${removeButton(qaArchiveEmail)}.textContent.trim() === 'Confirmar arquivamento'`));
      await evaluate(`${removeButton(qaArchiveEmail)}.click()`);
      await until(`!(${userRow(qaArchiveEmail)})`, 'conta arquivada some da lista');
      const keptTicket = (await api('GET', '/api/bootstrap')).body.data.tickets.find(t => t.id === archivedTicket.body.data.id);
      check('Arquivar tira a conta da lista e preserva o atendimento com o nome dela', !(await api('GET', '/api/users')).body.data.some(u => u.id === archiveId) && keptTicket?.attendant_name === 'Atendente QA Arquivar', keptTicket?.attendant_name);
      await shot('supervisor-equipe');
    }
    if (role === 'manager') {
      await evaluate(`location.hash='#visao-geral'`);
      await until(`!!document.querySelector('.donut-svg') && !!document.querySelector('.hero')`, 'visao geral do gestor');
      const managerReport = (await api('GET', '/api/reports')).body.data;
      const answered = managerReport.deadline ? managerReport.deadline.on_time + managerReport.deadline.late : 0;
      const overview = await evaluate(`({heroes: [...document.querySelectorAll('.hero')].map(h => ({bg: getComputedStyle(h).backgroundImage, value: h.querySelector('.hero-value').textContent.trim(), sub: h.querySelector('.hero-sub').textContent.trim(), area: !!h.querySelector('.hero-chart svg path.hero-fill')})), strip: [...document.querySelectorAll('.kpi-strip .strip-label')].map(e => e.textContent.trim()), cards: document.querySelectorAll('.stats .stat, .kpi').length, deadline: !!document.querySelector('.donut-svg[aria-label^="Cumprimento do prazo"]'), deadlineLegend: [...document.querySelectorAll('.donut-legend span')].map(e => e.textContent.trim()), deadlineValues: [...document.querySelectorAll('.donut-legend strong')].map(e => Number(e.textContent.trim().split(' ')[0])), databars: document.querySelectorAll('.databar-table .databar-fill.blue').length, negBars: document.querySelectorAll('.databar-table .databar-fill.pink').length, pct: document.querySelectorAll('.databar-table .pct-cell').length, stack: !!document.querySelector('.sbars'), gauge: !!document.querySelector('.gauge-svg'), heat: !!document.querySelector('.heatmap'), received: [...document.querySelectorAll('.databar-table tbody tr td:nth-child(2) b')].map(b => Number(b.textContent)), heatCells: [...document.querySelectorAll('.heat-box')].map(b => Number(b.textContent)), comparison: document.body.textContent.includes('Comparação com o período anterior'), agreement: /concord/i.test(document.body.textContent), accordions: document.querySelectorAll('details.acc').length})`);
      await shot('gestor-visao-geral');
      const dashTone = `(() => { const dash = document.querySelector('.theme-dash'); if (!dash) return null; const bg = getComputedStyle(dash).backgroundColor.match(/\\d+/g).map(Number); const fg = getComputedStyle(document.querySelector('h1')).color.match(/\\d+/g).map(Number); return { bgSum: bg[0] + bg[1] + bg[2], fgSum: fg[0] + fg[1] + fg[2], outside: !document.querySelector('.sidebar').closest('.theme-dash'), pressed: document.querySelector('[data-action="theme"]').getAttribute('aria-pressed'), label: document.querySelector('[data-action="theme"]').textContent.trim() }; })()`;
      const lightTone = await evaluate(dashTone);
      check('Gestor: tema claro e o padrao (fundo claro, texto escuro, botao oferece Tema escuro)', lightTone && lightTone.bgSum > 600 && lightTone.fgSum < 300 && lightTone.outside && lightTone.pressed === 'false' && lightTone.label === 'Tema escuro', lightTone);
      await shot('gestor-visao-geral-claro');
      await evaluate(`document.querySelector('[data-action="theme"]').click()`);
      const darkTone = await evaluate(dashTone);
      check('Gestor: botao liga o tema escuro (fundo azul-marinho, texto claro, so no contêiner do gestor) e guarda a escolha', darkTone && darkTone.bgSum < 150 && darkTone.fgSum > 600 && darkTone.outside && darkTone.pressed === 'true' && darkTone.label === 'Tema claro' && await evaluate(`localStorage.getItem('cti-tema') === 'escuro'`), darkTone);
      await shot('gestor-visao-geral');
      check('Gestor: 3 cartoes grandes em degrade (azul, verde, rosa) com area suave e valores da API', overview.heroes.length === 3 && overview.heroes.every(h => h.bg.includes('gradient') && h.area) && overview.heroes.map(h => h.value).join('|') === [managerReport.received, managerReport.sentiments.positive, managerReport.sentiments.negative].join('|') && overview.cards === 0, overview.heroes);
      check('Gestor: cartoes tem subtitulo verdadeiro (Melhor semana/dia, Pior semana/dia ou texto de ausencia)', overview.heroes.every(h => /^(Melhor|Pior) (dia|semana): .+ \(\d+ .+\)$|^Nenhum .+ no período$|^Série diária indisponível$/.test(h.sub)), overview.heroes.map(h => h.sub));
      check('Gestor: faixa de KPIs restantes (criticos, atrasados) fora de cartoes', overview.strip.join('|') === 'Casos críticos|Atrasados|Resolvidos|Aguardando cliente', overview.strip);
      check('Gestor: Visao geral nao traz comparacao nem accordions', !overview.comparison && overview.accordions === 0, overview);
      check('Gestor: Visao geral usa 6 tipos de grafico (area, rosca, data bars, empilhadas, gauge, mapa de calor)', overview.deadline && overview.databars > 0 && overview.negBars > 0 && overview.pct > 0 && overview.stack && overview.heat && (answered === 0 || overview.gauge), overview);
      check('Gestor: gauge de respondidos no prazo reflete a API', answered === 0 || await evaluate(`document.querySelector('.gauge-svg').getAttribute('aria-label').startsWith('${Math.round(managerReport.deadline.on_time / answered * 100)}% respondidos no prazo')`));
      check('Gestor: data bars por canal somam os feedbacks recebidos', overview.received.reduce((a, b) => a + b, 0) === managerReport.received, { tela: overview.received, api: managerReport.received });
      check('Gestor: mapa de calor por nivel reflete by_support_level da API', [1, 2, 3].every((level, i) => overview.heatCells.slice(i * 4, i * 4 + 4).reduce((a, b) => a + b, 0) === (managerReport.by_support_level[level] ?? 0)), { celulas: overview.heatCells, api: managerReport.by_support_level });
      check('Gestor: detalhamento do prazo esta na rosca (4 faixas)', overview.deadlineLegend.join('|') === 'No prazo|Fora do prazo|Aguardando no prazo|Vencido', overview);
      check('Gestor: rosca do prazo reflete a API', Boolean(managerReport.deadline) && overview.deadlineValues.join('|') === [managerReport.deadline.on_time, managerReport.deadline.late, managerReport.deadline.awaiting_on_time, managerReport.deadline.overdue].join('|'), { api: managerReport.deadline ?? 'campo deadline ausente', tela: overview.deadlineValues });
      check('Gestor: filtros em faixa superior com selects compactos e exportacao', await evaluate(`!!document.querySelector('.dash-band #filters-form #team_id') && !!document.querySelector('.dash-band a[download]') && document.querySelector('#team_id').getBoundingClientRect().height <= 44`));
      await evaluate(`location.hash='#indicadores'`);
      await until(`!!document.querySelector('.stackbar') && (${managerReport.trend.length < 2} || !!document.querySelector('.evo-svg'))`, 'indicadores do gestor');
      const indicators = await evaluate(`({stats: document.querySelectorAll('.stats .stat').length, area: !!document.querySelector('.evo-svg'), stack: !!document.querySelector('.stackbar'), teams: !!document.querySelector('.data-table'), topics: document.body.textContent.includes('Assuntos que mais aparecem'), bars: document.querySelectorAll('.vs-bars').length, agreement: /concord/i.test(document.body.textContent)})`);
      check('Gestor: Indicadores tem comparacao com o periodo anterior antes dos graficos', await evaluate(`(() => { const heading = [...document.querySelectorAll('h2')].find(h => h.textContent === 'Comparação com o período anterior'); const chart = document.querySelector('.chart-card'); return Boolean(heading) && Boolean(heading.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING); })()`));
      check('Gestor: Visao geral nao traz comparacao', !overview.comparison, overview);
      check('Comparacao do gestor reflete a API e mostra as duas janelas (depende do backend)', await evaluate(`(() => { const c = ${JSON.stringify(managerReport.comparison ?? null)}; if (!c) return false; const cards = [...document.querySelectorAll('.comparison-stat')]; const short = v => v.slice(8, 10) + '/' + v.slice(5, 7); const windows = document.querySelector('.comparison-windows')?.textContent ?? ''; return cards.length === 3 && ['Feedbacks recebidos', 'Percentual de negativos', 'Casos críticos'].every((label, i) => cards[i].querySelector('.stat-label').textContent === label) && cards[0].textContent.includes('Antes: ' + c.previous.received) && cards[1].textContent.includes('Antes: ' + c.previous.negative_percent + '%') && cards[2].textContent.includes('Antes: ' + c.previous.critical) && windows.includes('De ' + short(c.current.from) + ' a ' + short(c.current.to) + ' contra ' + short(c.previous.from) + ' a ' + short(c.previous.to)); })()`), managerReport.comparison ?? 'campo comparison ausente');
      check('Comparacao do gestor com separacao visivel entre Antes e a variacao', await evaluate(`(() => { const text = [...document.querySelectorAll('.comparison-stat')].map(c => c.textContent).join('|'); return text.length > 0 && !text.includes('0sem') && !text.includes('%sem'); })()`));
      check('Comparacao do gestor: nem todos os cartoes dizem sem base de comparacao (depende do backend)', await evaluate(`(() => { const cards = [...document.querySelectorAll('.comparison-stat')]; return cards.length === 3 && cards.some(c => !c.textContent.includes('sem base de comparação')); })()`));
      check('Comparacao do gestor tem setas de variacao e mini barras atual x anterior', await evaluate(`(() => { const cards = [...document.querySelectorAll('.comparison-stat')]; return cards.length === 3 && cards.every(c => c.querySelector('.vs-now') && c.querySelector('.vs-prev')) && cards.some(c => /[↑↓→]/.test(c.querySelector('.delta')?.textContent ?? '')); })()`));
      check('Gestor: Indicadores tem comparacao, grafico de evolucao em area, distribuicao e assuntos visiveis', indicators.stats === 3 && indicators.stack && indicators.topics && (managerReport.trend.length < 2 || indicators.area) && !indicators.teams, indicators);
      if (managerReport.trend.length >= 2) {
        const evo = await evaluate(`(() => { const svg = document.querySelector('svg.evo-svg'); const wrap = svg.closest('.evo-wrap'); return { role: svg.getAttribute('role'), label: svg.getAttribute('aria-label'), points: svg.querySelectorAll('.evo-dot').length, negPoints: svg.querySelectorAll('.evo-dot-neg').length, line: !!svg.querySelector('path.evo-line-total'), area: !!svg.querySelector('path.evo-area'), peak: !!svg.querySelector('.evo-flag-text'), gradient: !!svg.querySelector('linearGradient'), ticks: [...svg.querySelectorAll('.evo-tick')].length, viewBox: svg.getAttribute('viewBox'), legend: wrap.closest('.evo-panel').querySelector('.legend').textContent, details: !!wrap.closest('.evo-panel').querySelector('details.evo-data table tbody tr') }; })()`);
        check('Evolucao: svg role=img com aria-label resumido, mais de 1 ponto, area, linha, pico, legenda e tabela de dados', evo.role === 'img' && evo.label.length > 40 && evo.points > 1 && evo.negPoints > 1 && evo.line && evo.area && evo.peak && evo.gradient && evo.legend.includes('Negativos') && evo.details, evo);
        check('Evolucao: rotulos do eixo X nao se sobrepoem', await evaluate(`(() => { const boxes = [...document.querySelectorAll('.evo-svg text.evo-tick')].map(t => t.getBoundingClientRect()).filter(b => b.top > document.querySelector('.evo-svg').getBoundingClientRect().bottom - 40); boxes.sort((a, b) => a.left - b.left); return boxes.length >= 2 && boxes.every((b, i) => i === 0 || b.left >= boxes[i - 1].right + 2); })()`));
        await evaluate(`(() => { const svg = document.querySelector('svg.evo-svg'); const r = svg.getBoundingClientRect(); svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5 })); })()`);
        check('Evolucao: tooltip aparece no hover com valor e data', await evaluate(`(() => { const tip = document.querySelector('.evo-tip'); return !tip.hidden && /Feedbacks: \\d+/.test(tip.textContent) && /Negativos: \\d+/.test(tip.textContent) && /\\d{2}\\/\\d{2}/.test(tip.textContent) && document.querySelector('.evo-hover.on') !== null; })()`));
        await evaluate(`document.querySelector('[data-action="evo-mode"][aria-pressed="false"]').click()`);
        check('Evolucao: alternar Dia/Semana redesenha o grafico e mantem o role=img', await evaluate(`(() => { const svg = document.querySelector('svg.evo-svg'); return svg.getAttribute('role') === 'img' && !!svg.querySelector('path.evo-line-total') && svg.querySelectorAll('.evo-tick').length > 3 && document.querySelectorAll('[data-action="evo-mode"][aria-pressed="true"]').length === 1; })()`));
        const pageWidth = await evaluate('({w: document.documentElement.scrollWidth, v: innerWidth})');
        check('Evolucao: nao estoura a largura da pagina em 1440', pageWidth.w <= pageWidth.v, pageWidth);
      } else check('Evolucao: com menos de 2 dias mostra estado vazio claro', await evaluate(`document.querySelector('.evo-panel').textContent.includes('Ainda não há série suficiente')`));
      await shot('gestor-indicadores');
      check('Gestor: sem concordancia IA x humano na UI nem na API', !overview.agreement && !indicators.agreement && managerReport.agreement === undefined, { overview: overview.agreement, indicators: indicators.agreement, api: managerReport.agreement });
      await evaluate(`location.hash='#equipes'`);
      await until(`!!document.querySelector('.databar-table')`, 'equipes do gestor');
      check('Gestor: Comparacao entre equipes herda o tema escuro e tem data bars com ate 4 colunas', await evaluate(`!!document.querySelector('.theme-dash .databar-table') && ${visibleCols}.every(n => n <= 4) && document.querySelectorAll('.databar-table .databar-fill').length >= 3`));
      await shot('gestor-equipes');
      await evaluate(`location.hash='#relatorios'`);
      await until(`!!document.querySelector('#team_id')`);
      await evaluate(`document.querySelector('#team_id').value='2';document.querySelector('#filters-form').requestSubmit()`);
      await until(`document.querySelector('#toast').textContent.includes('Filtros aplicados')`);
      const filtered = await api('GET', '/api/reports?team_id=2');
      const count = await evaluate(`Number(document.querySelector('.stat-value').textContent)`);
      check('Gestor aplica filtro de equipe nos indicadores', count === filtered.body.data.received, { rendered: count, database: filtered.body.data.received });
      await evaluate(`document.querySelector('[data-action="report-type"][data-type="criticality"]').click()`);
      await until(`document.body.textContent.includes('Relatório de criticidade') || document.querySelector('[data-action="report-type"][data-type="criticality"]')?.classList.contains('selected')`);
      check('Gestor acessa relatorio de criticidade', await evaluate(`!!document.querySelector('[data-action="report-type"][data-type="criticality"]')`));
      check('Gestor: Relatorios herda o tema escuro e mantem tabelas com ate 4 colunas e sem rolagem horizontal', await evaluate(`!!document.querySelector('.theme-dash') && ${visibleCols}.every(n => n <= 4) && document.documentElement.scrollWidth <= innerWidth`));
      await shot('gestor-filtro-criticidade');
      check('Gestor tem a aba Supervisores no fim do menu', links.at(-1)?.href === '#supervisores', links);
      const supervisors = (await api('GET', '/api/users')).body.data;
      const qaTeam = supervisors.find(s => Number(s.active) === 1)?.team_id;
      await evaluate(`location.hash='#supervisores'`);
      await until(`!!document.querySelector('#user-form #team_id') && !!document.querySelector('#users-list .data-table')`, 'aba Supervisores do gestor');
      check('Supervisores do gestor: select com todas as equipes', await evaluate(`[...document.querySelectorAll('#team_id option')].filter(o => o.value).map(o => o.value).join('|') === ${JSON.stringify(boot.body.data.teams.map(t => String(t.id)).join('|'))}`), boot.body.data.teams);
      check('Supervisores do gestor listam os supervisores da API', await evaluate(`document.querySelectorAll('#users-list tbody tr').length`) === supervisors.length);
      await createUser('Supervisor QA Navegador', qaSupervisorEmail, qaTeam);
      const newSupervisor = (await api('GET', '/api/users')).body.data.find(u => u.email === qaSupervisorEmail);
      check('Gestor cria supervisor ativo na equipe escolhida', Number(newSupervisor?.active) === 1 && Number(newSupervisor.team_id) === Number(qaTeam), newSupervisor);
      await toggleUser(qaSupervisorEmail, newSupervisor.id, 'user-deactivate', 'Inativo');
      check('Gestor desativa o supervisor', Number((await api('GET', '/api/users')).body.data.find(u => u.id === newSupervisor.id)?.active) === 0);
      await toggleUser(qaSupervisorEmail, newSupervisor.id, 'user-reactivate', 'Ativo');
      check('Gestor reativa o supervisor', Number((await api('GET', '/api/users')).body.data.find(u => u.id === newSupervisor.id)?.active) === 1);
      await evaluate(`(${userRow(qaSupervisorEmail)}).querySelector('[data-action="user-edit"]').click()`);
      check('Gestor: Editar carrega a equipe do supervisor', await evaluate(`document.querySelector('#user-form #team_id').value === ${JSON.stringify(String(qaTeam))} && document.querySelector('#user-form').closest('.form-card').querySelector('h2').textContent === 'Editar supervisor'`));
      await evaluate(`(() => { const f = document.querySelector('#user-form'); f.querySelector('#user_name').value = 'Supervisor QA Editado'; f.requestSubmit(); })()`);
      await until(`(${userRow(qaSupervisorEmail)})?.textContent.includes('Supervisor QA Editado')`, 'supervisor editado');
      check('Gestor edita o nome do supervisor', (await api('GET', '/api/users')).body.data.find(u => u.id === newSupervisor.id)?.name === 'Supervisor QA Editado');
      const usersTone = await evaluate(`(() => { const sum = el => getComputedStyle(el).color.match(/\\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0); return { dark: !!document.querySelector('.theme-dash.dark'), cell: sum(document.querySelector('#users-list tbody td')), label: sum(document.querySelector('label[for="user_name"]')), input: sum(document.querySelector('#user_name')) }; })()`);
      check('Supervisores legivel no tema escuro do gestor (texto claro)', usersTone.dark && usersTone.cell > 450 && usersTone.label > 450 && usersTone.input > 450, usersTone);
      await shot('gestor-supervisores');
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await pause(200);
    for (const [index, link] of links.entries()) {
      await evaluate(`location.hash=${JSON.stringify(link.href)}`);
      await pause(600);
      const wide = await evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth,title:document.querySelector("h1")?.textContent})');
      check(`Desktop 1280 sem rolagem horizontal ${role}: ${link.text}`, Boolean(wide.title) && wide.width <= wide.viewport, wide);
      check(`Desktop 1280 tabelas com no maximo 4 colunas visiveis ${role}: ${link.text}`, (await evaluate(visibleCols)).every(n => n <= 4));
      await shot(`${role}-d${index}`, 1280);
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await pause(200);
    const width = await evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth})');
    check(`Layout mobile ${role}`, width.width <= width.viewport, width);
    await shot(`${role}-mobile`, 390);
    await evaluate('location.reload()');
    await pause(800);
    await until('!!document.querySelector("nav")', `recarga mobile ${role}`);
    for (const [index, link] of links.entries()) {
      await evaluate(`location.hash=${JSON.stringify(link.href)}`);
      await pause(500);
      await evaluate(`(() => { const toast = document.querySelector('#toast'); if (toast) toast.style.display = 'none'; })()`);
      const mobile = await evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth,title:document.querySelector("h1")?.textContent})');
      check(`Mobile 390 sem rolagem horizontal ${role}: ${link.text}`, Boolean(mobile.title) && mobile.width <= mobile.viewport, mobile);
      check(`Mobile 390 tabelas com no maximo 4 colunas visiveis ${role}: ${link.text}`, (await evaluate(visibleCols)).every(n => n <= 4));
      await shot(`${role}-m${index}`, 390);
      if ((role === 'supervisor' && link.href === '#dashboard') || (role === 'attendant' && link.href === '#relatorio')) {
        const label = role === 'supervisor' ? 'Casos para tratar' : 'Prazos que precisam de atencao';
        const heading = role === 'supervisor' ? 'Casos para tratar' : 'Prazos que precisam de atenção';
        await until(`document.body.innerText.includes(${JSON.stringify(heading)})`, `secao ${label} no mobile`);
        const action = await evaluate(`(() => { const h = [...document.querySelectorAll('h2')].find(el => el.textContent === ${JSON.stringify(heading)}); const table = h?.closest('.section-head')?.nextElementSibling?.querySelector('table.table-priority'); const target = table?.querySelector('tbody .text-link'); if (!target) return null; const box = target.getBoundingClientRect(); return {right: Math.round(box.right), left: Math.round(box.left), viewport: innerWidth, wrapScroll: table.parentElement.scrollWidth > table.parentElement.clientWidth}; })()`);
        check(`Mobile 390: botao de acao de ${label} (${role}) dentro da largura visivel`, Boolean(action) && action.right <= action.viewport && action.left >= 0, action);
        await shot(`${role}-m-${role === 'supervisor' ? 'dashboard' : 'relatorio'}-acao`, 390);
      }
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }
  await api('POST', '/api/logout');
  await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
  await until(`!!document.querySelector('#login-form')`, 'sessao expirada apresenta login');
  await evaluate(`document.querySelector('#login-email').value='rafael@cti.demo';document.querySelector('#login-password').value='CtiDemo2026!';document.querySelector('#login-form').requestSubmit()`);
  await until(`!!document.querySelector('nav')`, 'login apos expiracao sem recarregar');
  check('Sessao expirada permite novo login sem recarregar', (await api('GET', '/api/bootstrap')).body.data.user.role === 'attendant');
  await evaluate(`document.querySelector('[data-action="logout"]').click()`);
  await until(`!!document.querySelector('#login-form')`, 'logout antes do atendente novo');
  await evaluate(`document.querySelector('#login-email').value=${JSON.stringify(qaAttendantEmail)};document.querySelector('#login-password').value='CtiDemo2026!';document.querySelector('#login-form').requestSubmit()`);
  await until(`!!document.querySelector('nav')`, 'login do atendente criado pela supervisora');
  const qaAttendantUser = (await api('GET', '/api/bootstrap')).body.data.user;
  check('Atendente criado pela supervisora entra com a senha padrao', qaAttendantUser.role === 'attendant' && qaAttendantUser.email === qaAttendantEmail, qaAttendantUser);
  check('Sem excecoes nem assets quebrados', errors.length === 0, errors);
} catch (error) {
  errors.push({ type: 'qa', message: error.message });
  check('Execucao do navegador', false, error.message);
} finally {
  const summary = { passed: !process.exitCode && errors.length === 0, results, errors };
  await writeFile(path.join(output, 'resultado.json'), JSON.stringify(summary, null, 2));
  console.log(`RESULT ${results.filter(r=>r.passed).length}/${results.length}`);
  if (socket?.readyState === WebSocket.OPEN) { try { await cdp('Browser.close'); } catch {} socket.close(); }
  browser?.kill();
}
