import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'storage', 'qa');
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
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
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
      if (!expectedAuthentication) errors.push({ type: 'log', details: entry });
    }
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Log.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base });
  await until('!!document.querySelector("form")', 'formulario de login');
  await shot('login');
  check('Login exibe logo oficial', await evaluate(`!![...document.images].find(img => img.src.includes('cti-oficial.png') && img.complete && img.naturalWidth > 0)`));
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
    }
    if (role !== 'client') {
      const report = await api('GET', '/api/reports');
      check(`Relatorio real ${role}`, report.status === 200 && typeof report.body.data.total_tickets === 'number');
      const csv = await api('GET', '/api/reports/export');
      check(`CSV ${role}`, csv.status === 200 && csv.type.includes('text/csv') && typeof csv.body === 'string' && csv.body.length > 30);
    }
    if (role === 'attendant') {
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
      await api('PATCH', `/api/tickets/${workflowTicket}`, { response_due_at: new Date(Date.now() - 3600000).toISOString() });
      await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
      await until(`document.querySelector('#toast').textContent.includes('Há novos lembretes')`, 'lembrete atualizado sem navegar');
      check('Lembrete atualiza preservando digitacao e formulario', await evaluate(`document.querySelector('#ticket-form')===window.__qaForm && document.querySelector('#subject').value==='Rascunho ainda nao salvo'`));
      const alerts = (await api('GET', '/api/bootstrap')).body.data.notifications.length;
      check('Contador de alertas acompanha banco sem recarregar', await evaluate(`Number(document.querySelector('#notification-count').textContent)===${alerts}`));
      await evaluate(`document.querySelector('#message').value='Estamos validando a conexao VPN. Retornaremos no prazo informado.';document.querySelector('#reply-form').requestSubmit()`);
      await until(`document.querySelector('#toast').textContent.includes('Resposta registrada')`);
      await evaluate(`document.querySelector('#solution').value='Credenciais VPN renovadas e rotas validadas com teste de conexao.';document.querySelector('#solution-form').requestSubmit()`);
      await until(`!document.querySelector('#solution-form') && document.querySelector('.badge.awaiting_feedback')`, 'solucao aguardando confirmacao');
      const solved = (await api('GET', '/api/bootstrap')).body.data.tickets.find(t => t.id === workflowTicket);
      check('UI envia solucao apenas uma vez sem encerrar', solved.status === 'awaiting_feedback' && solved.manual_status_changes === 1);
      check('UI sem seletor de status', await evaluate(`!document.querySelector('select[name="status"]')`));
      await shot('atendimento-criado');
      await evaluate(`location.hash='#pagina-inexistente'`);
      await until(`document.querySelector('h1')?.textContent.includes('Não encontramos esta página.')`, 'pagina 404');
      check('Pagina inexistente oferece retorno ao espaco do perfil', await evaluate(`!!document.querySelector('.standalone-error a[href="#atendimentos"]')`));
      await shot('pagina-404');
      await evaluate(`document.querySelector('.standalone-error a').click()`);
      await until(`!!document.querySelector('nav')`, 'retorno da pagina 404');
    }
    if (role === 'client') {
      await evaluate(`location.hash='#enviar-feedback?ticket=${workflowTicket}'`);
      await until(`!!document.querySelector('#feedback-text')`);
      await evaluate(`document.querySelector('#feedback-text').value='Ainda preciso de ajuda';document.querySelector('#feedback-text').dispatchEvent(new Event('input',{bubbles:true}))`);
      check('Texto bloqueia gravacao concorrente', await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="audio"]').disabled`));
      await evaluate(`document.querySelector('[data-action="clear-feedback"]').click()`);
      check('Limpar libera troca de formato', await evaluate(`!document.querySelector('[data-action="feedback-mode"][data-mode="audio"]').disabled`));
      await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="audio"]').click();document.querySelector('#record-start').click()`);
      await until(`document.querySelector('#record-stop') && !document.querySelector('#record-stop').hidden`, 'microfone sintetico iniciado');
      await pause(1300);
      check('Gravacao bloqueia texto concorrente', await evaluate(`document.querySelector('[data-action="feedback-mode"][data-mode="text"]').disabled`));
      await evaluate(`document.querySelector('#record-stop').click()`);
      await until(`!!document.querySelector('#audio-preview audio')`, 'WAV gravado pelo navegador');
      await until(`document.querySelector('#audio-preview audio').readyState >= 1`, 'preview de audio decodificado');
      const wave = await evaluate(`({duration:document.querySelector('#audio-preview audio').duration,blob:document.querySelector('#audio-preview audio').src.startsWith('blob:')})`);
      check('Navegador reproduz WAV com microfone sintetico', wave.blob && wave.duration > 0 && wave.duration <= 60, wave);
      await evaluate(`document.querySelector('[data-action="clear-feedback"]').click();location.hash='#atendimentos'`);
      await until(`!!document.querySelector('[data-action="quick-feedback"][data-id="${workflowTicket}"]')`);
      await evaluate(`document.querySelector('[data-action="quick-feedback"][data-id="${workflowTicket}"]').click()`);
      await until(`!!document.querySelector('form[data-form="quick-feedback"]')`);
      await evaluate(`document.querySelector('form[data-form="quick-feedback"] input[name="rating"][value="1"]').checked=true;document.querySelector('#resolved-${workflowTicket}').value='0';document.querySelector('form[data-form="quick-feedback"] [data-submit]').click()`);
      await until(`document.querySelector('#toast').textContent.includes('ainda precisa de ajuda')`);
      const rejected = (await api('GET', '/api/bootstrap')).body.data.tickets.find(t => t.id === workflowTicket);
      check('Avaliacao rapida negativa mantem atendimento aberto', rejected.status === 'active' && rejected.manual_status_changes === 1);
      await shot('cliente-feedback-negativo');
    }
    if (role === 'supervisor') {
      const fresh = (await api('GET', '/api/bootstrap')).body.data;
      const feedback = fresh.feedbacks.find(f => f.ticket_id === workflowTicket);
      await evaluate(`location.hash='#feedbacks'`);
      await until(`!!document.querySelector('[data-action="feedback-detail"][data-id="${feedback.id}"]')`);
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
    }
    if (role === 'manager') {
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
      await shot('gestor-filtro-criticidade');
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await pause(200);
    const width = await evaluate('({width:document.documentElement.scrollWidth,viewport:innerWidth})');
    check(`Layout mobile ${role}`, width.width <= width.viewport, width);
    await shot(`${role}-mobile`, 390);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }
  await api('POST', '/api/logout');
  await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
  await until(`!!document.querySelector('#login-form')`, 'sessao expirada apresenta login');
  await evaluate(`document.querySelector('#login-email').value='rafael@cti.demo';document.querySelector('#login-password').value='CtiDemo2026!';document.querySelector('#login-form').requestSubmit()`);
  await until(`!!document.querySelector('nav')`, 'login apos expiracao sem recarregar');
  check('Sessao expirada permite novo login sem recarregar', (await api('GET', '/api/bootstrap')).body.data.user.role === 'attendant');
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
