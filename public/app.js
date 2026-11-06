const app = document.querySelector('#app');
const dialog = document.querySelector('#detail-dialog');
const state = { user: null, csrf: '', data: null, report: null, route: '', params: new URLSearchParams(), filters: {}, decision: null, formMode: 'text', audio: null, recording: false, modalFeedbackId: null, caseResults: [], selectedCategory: null, renderId: 0 };
const roleNames = { attendant: 'Atendente', supervisor: 'Supervisor', manager: 'Gestor', client: 'Cliente' };
const statusNames = { active: 'Em atendimento', awaiting_feedback: 'Aguardando cliente', resolved: 'Resolvido', closed_no_response: 'Encerrado sem retorno' };
const sentimentNames = { positive: 'Positivo', neutral: 'Neutro', negative: 'Negativo', pending: 'Pendente' };
const criticalityNames = { critical: 'Crítico', regular: 'Regular' };
const modeNames = { quick: 'Avaliação rápida', text: 'Texto', audio: 'Áudio gravado' };
const routes = {
  attendant: [['atendimentos', 'Meus atendimentos'], ['registrar', 'Registrar atendimento'], ['clientes', 'Clientes'], ['feedbacks', 'Feedbacks dos meus atendimentos'], ['relatorio', 'Meu relatório']],
  supervisor: [['dashboard', 'Dashboard da equipe'], ['atendimentos', 'Atendimentos da equipe'], ['feedbacks', 'Feedbacks da equipe'], ['criticos', 'Casos críticos']],
  manager: [['visao-geral', 'Visão geral'], ['indicadores', 'Indicadores e tendências'], ['equipes', 'Comparação entre equipes'], ['relatorios', 'Relatórios']],
  client: [['enviar-feedback', 'Enviar feedback'], ['feedbacks', 'Meus feedbacks']]
};
let caseTimer;
let toastTimer;
let recordingSession = null;
let restoreFocus = null;
let activeMutations = 0;
let mutationVersion = 0;
let notificationPollInFlight = false;

function esc(value = '') { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function num(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function initial() { return esc(state.user?.name?.[0] || 'C'); }
function icon(file, size = 18) { return `<span class="icon" aria-hidden="true"><img src="/assets/figma/${file}.svg" width="${size}" height="${size}" alt=""></span>`; }
function navigationIcon(path) {
  const active = state.route === path;
  const files = { atendimentos: active ? '74d5d' : '3beb0', registrar: active ? '218d5' : '5bf39', clientes: active ? '5b8fb' : '82039', feedbacks: active ? '5dc6e' : '3928a', dashboard: 'fe998', criticos: 'a8049', 'visao-geral': active ? '3b9ea' : 'fe998', indicadores: active ? '2ccfc' : '164c8', equipes: active ? '5b8fb' : '82039', relatorios: active ? '75e27' : '34ec9', 'enviar-feedback': active ? '45599' : '35636' };
  return files[path] ? icon(files[path]) : '';
}
function date(value, time = false) { if (!value) return 'Não informado'; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value); return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString('pt-BR', time ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }); }
function badge(value, names = statusNames) { return `<span class="badge ${esc(value)}">${esc(names[value] || value || 'Pendente')}</span>`; }
function empty(title, detail = '') { return `<div class="empty"><h3>${esc(title)}</h3>${esc(detail)}</div>`; }
function btn(label, action, cls = '', extra = '') { return `<button type="button" class="btn ${cls}" data-action="${esc(action)}" ${extra}>${label}</button>`; }
function link(label, path, cls = 'btn btn-primary') { return `<a class="${cls}" href="#${esc(path)}">${label}</a>`; }
function input(name, label, type = 'text', value = '', extra = '', hint = '') { return `<div class="field"><label for="${esc(name)}">${esc(label)}</label><input id="${esc(name)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${extra}>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`; }
function select(name, label, options, value = '', extra = '') { return `<div class="field"><label for="${esc(name)}">${esc(label)}</label><select id="${esc(name)}" name="${esc(name)}" ${extra}>${options.map(o => { const pair = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(pair[0])}" ${String(value) === String(pair[0]) ? 'selected' : ''}>${esc(pair[1])}</option>`; }).join('')}</select></div>`; }
function textarea(name, label, value = '', extra = '', hint = '') { return `<div class="field full"><label for="${esc(name)}">${esc(label)}</label><textarea id="${esc(name)}" name="${esc(name)}" ${extra}>${esc(value)}</textarea>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`; }
function toast(message, isError = false) { const el = document.querySelector('#toast'); clearTimeout(toastTimer); el.className = `toast${isError ? ' error' : ''}`; el.textContent = message; el.hidden = false; toastTimer = setTimeout(() => el.hidden = true, 5500); }
function formError(form, error) { let box = form.querySelector('.inline-error'); if (!box) { box = document.createElement('div'); box.className = 'inline-error'; box.setAttribute('role', 'alert'); form.prepend(box); } box.textContent = error.message || 'Não foi possível concluir. Tente novamente.'; box.scrollIntoView({ block: 'nearest' }); }
async function api(path, options = {}) {
  const mutation = Boolean(options.method && options.method !== 'GET');
  if (mutation) { activeMutations++; mutationVersion++; }
  try {
  const headers = { Accept: 'application/json', ...options.headers };
  if (mutation) headers['X-CSRF-Token'] = state.csrf;
  if (options.body && !(options.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.body); }
  let response;
  try { response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers }); } catch { throw new Error('Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.'); }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 && path !== '/login') { state.user = null; state.data = null; renderLogin(); } throw new Error(json.message || `Não foi possível concluir a operação (${response.status}).`); }
  return json.data;
  } finally { if (mutation) activeMutations--; }
}
function demoBanner() { return `<div class="banner" role="note">${icon('20913')}<div><strong>Escuta com apoio de IA.</strong> Novos relatos são analisados localmente. A base inicial contém exemplos fictícios identificados nos detalhes.</div></div>`; }
let themeMemory = null;
function dashDark() { if (themeMemory !== null) return themeMemory; try { return localStorage.getItem('cti-tema') === 'escuro'; } catch { return false; } }
function brand(onLight = false) { return onLight ? `<div class="brand brand-dark"><div><span class="brand-logo"><img src="/assets/cti-oficial.png" width="416" height="158" alt="CTI, conectando empresas e pessoas"></span><div class="brand-word">escuta</div></div></div>` : `<div class="brand"><div><span class="brand-logo brand-logo-white"><img src="/assets/cti-logo-branca.png" width="131" height="109" alt="CTI, conectando empresas e pessoas"></span><div class="brand-word">escuta</div></div></div>`; }
function renderLogin() {
  app.innerHTML = `<div class="login"><section class="login-hero">${brand()}<div class="login-hero-content"><div class="eyebrow">Conexões que começam com a escuta</div><h1>Cada experiência<br>tem algo <span>a dizer.</span></h1><p>Transforme feedbacks em cuidado. Conecte sua equipe ao que realmente importa.</p><div class="login-art" aria-label="Conectividade, segurança e cloud"><div class="orbit"></div><div class="orbit inner"></div><div class="hero-message">${icon('a9fb2', 52)}</div><div class="hero-tag connect">${icon('a7dc4', 15)}Conectividade</div><div class="hero-tag secure">${icon('77d7c', 15)}Segurança</div><div class="hero-tag cloud">${icon('834ef', 15)}Cloud</div></div></div><div class="login-footer"><span>Conexões que importam</span></div></section><section class="login-panel"><main id="main" class="login-panel-center"><div class="login-form"><div class="eyebrow">Bem-vindo à CTI Escuta</div><h2>Bom ter você por aqui.</h2><p>Entre para acessar o seu espaço.</p><form id="login-form" class="login-fields"><div class="field"><label for="login-email">E-mail</label><input id="login-email" name="email" type="email" placeholder="seu.email@empresa.com.br" autocomplete="username" required></div><div class="field"><label for="login-password">Senha</label><input id="login-password" name="password" type="password" placeholder="Sua senha" autocomplete="current-password" required></div><button class="btn btn-primary" type="submit"><span>Entrar na plataforma</span>${icon('f45dc')}</button></form><div class="secure-caption">${icon('3f6e3', 15)}Acesso seguro e exclusivo para a sua conta</div><div class="login-note"><strong>Um só lugar. A escuta certa para cada pessoa.</strong>Seu acesso é definido pela sua conta. Precisa de ajuda? Procure o responsável pela plataforma.</div><details class="demo-accounts"><summary>Acessos de demonstração</summary>${[['rafael', 'Atendente'], ['marina', 'Supervisor'], ['helena', 'Gestor'], ['lucas', 'Cliente']].map(([name, role]) => `<button class="demo-account" data-action="demo-login" data-email="${name}@cti.demo" type="button">${role}: ${name}@cti.demo</button>`).join('')}<p>Senha das contas fictícias: <strong>CtiDemo2026!</strong></p></details></div></main><div class="login-footer"><span>CTI Escuta</span><span>Privacidade em primeiro lugar</span></div></section></div>`;
  document.title = 'Entrar | CTI Escuta';
}
function pageMeta() {
  const role = state.user.role;
  const item = routes[role]?.find(r => r[0] === state.route);
  let title = item?.[1] || 'Página não encontrada';
  if (state.route === 'registrar' && state.params.has('id')) title = 'Atualizar atendimento';
  const subtitle = role === 'client' ? 'Sua experiência importa. Estamos aqui para ouvir você.' : role === 'attendant' ? 'Cada atendimento é uma oportunidade de fazer a diferença.' : role === 'supervisor' ? 'Uma visão clara para cuidar de cada conexão da sua equipe.' : 'Transforme a voz dos clientes em decisões com propósito.';
  return { title, subtitle };
}
function shell(content) {
  const { title, subtitle } = pageMeta();
  const alerts = state.data.notifications || [];
  app.innerHTML = `<div class="layout"><button class="mobile-backdrop" data-action="menu-close" aria-label="Fechar menu"></button><aside class="sidebar" id="sidebar"><div class="sidebar-brand">${brand()}</div><div class="space-label">Espaço ${esc(roleNames[state.user.role].toLowerCase())}</div><nav class="nav-list" aria-label="Menu principal">${routes[state.user.role].map(([path, label]) => `<a href="#${path}" class="nav-link ${state.route === path ? 'active' : ''}" ${state.route === path ? 'aria-current="page"' : ''}>${navigationIcon(path)}${esc(label)}${path === 'criticos' && state.data.feedbacks.some(f => f.criticality === 'critical') ? '<span class="nav-mark" aria-label="Há casos críticos"></span>' : ''}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="listen-card"><strong>Vamos ouvir melhor?</strong><p>Feedbacks são o começo de uma boa conexão.</p></div><div class="user-panel"><div class="avatar">${initial()}</div><div><div class="user-name">${esc(state.user.name)}</div><div class="user-role">${esc(roleNames[state.user.role])}</div></div><button class="logout-btn" data-action="logout" title="Sair da conta" aria-label="Sair da conta">${icon('fe916')}</button></div></div></aside><div class="work-area${state.user.role === 'manager' ? ` theme-dash${dashDark() ? ' dark' : ''}` : ''}"><header class="topbar"><div class="button-row"><button type="button" class="menu-btn" data-action="menu" aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">☰</button><div class="breadcrumb"><strong>${esc(roleNames[state.user.role])}</strong></div></div><div class="header-actions">${state.user.role === 'manager' ? `<button type="button" class="btn theme-toggle" data-action="theme" aria-pressed="${dashDark()}">${dashDark() ? 'Tema claro' : 'Tema escuro'}</button>` : `<button class="notification-btn" data-action="notifications" aria-label="Alertas e lembretes${alerts.length ? `: ${alerts.length}` : ''}" title="Alertas e lembretes">◷${alerts.length ? `<span id="notification-count" class="notification-count">${alerts.length}</span>` : ''}</button>`}<div class="avatar">${initial()}</div></div></header><main id="main" class="main"><div class="page-heading"><div><div class="eyebrow">Ouvir. Entender. Evoluir.</div><h1>${esc(title)}<span class="dot">.</span></h1>${state.user.role === 'manager' ? '' : `<p>${esc(subtitle)}</p>`}</div>${['manager', 'supervisor'].includes(state.user.role) ? `<div class="date-pill">${icon('2fbac', 15)}${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>` : ''}</div>${demoBanner()}<div id="page-content">${content}</div><footer class="footer"><span>CTI Escuta · Cada voz, uma oportunidade.</span></footer></main></div></div>`;
  document.title = `${title} | CTI Escuta`;
}
async function refreshData() { state.data = await api('/bootstrap'); state.user = state.data.user || state.user; }
async function render() {
  const id = ++state.renderId;
  stopRecording(true);
  if (!state.user) return renderLogin();
  const hash = location.hash.slice(1);
  const [route, query = ''] = hash.split('?');
  state.route = route || routes[state.user.role][0][0];
  state.params = new URLSearchParams(query);
  state.formMode = 'text';
  clearAudio();
  if (!state.data) {
    try { await refreshData(); } catch (error) { if (state.user) app.innerHTML = `<main id="main" class="initial-loading"><div><p>${esc(error.message)}</p>${btn('Tentar novamente', 'refresh')}</div></main>`; return; }
  }
  if (id !== state.renderId) return;
  if (!routes[state.user.role].some(r => r[0] === state.route)) { app.innerHTML = `<main id="main" class="standalone-error"><div><div class="error-brand">${brand(true)}</div><div class="error-code" aria-hidden="true">404</div><div class="eyebrow">CTI Escuta · Erro 404</div><h1>Não encontramos esta página.</h1><p>Você pode voltar ao seu espaço pela página inicial.</p>${link(`Voltar ao meu espaço ${icon('f45dc')}`, routes[state.user.role][0][0])}</div></main>`; document.title = 'Página não encontrada | CTI Escuta'; return; }
  if (state.route === 'atendimentos') shell(ticketsPage());
  else if (state.route === 'registrar') { shell(registerPage()); loadRelatedCases(); }
  else if (state.route === 'clientes') shell(clientsPage());
  else if (state.route === 'feedbacks') shell(feedbacksPage());
  else if (state.route === 'enviar-feedback') shell(feedbackFormPage());
  else if (state.route === 'criticos') shell(criticalPage());
  else { shell(`<div class="card loading-card"><span class="spinner"></span>Calculando os indicadores do banco...</div>`); try { state.report = await api(`/reports?${new URLSearchParams(state.filters)}`); if (id !== state.renderId) return; showReport(); } catch (error) { if (id === state.renderId) document.querySelector('#page-content').innerHTML = `<div class="inline-error" role="alert">${esc(error.message)}</div>`; } }
}
function ticketFeedback(ticket) { return state.data.feedbacks.find(f => Number(f.ticket_id) === Number(ticket.id) && (f.attempt === undefined || ticket.solution_attempt === undefined || Number(f.attempt) === Number(ticket.solution_attempt))); }
function canFeedback(ticket) { return ticket.status === 'awaiting_feedback' && !ticketFeedback(ticket); }
function repliesBlock(ticket) { const replies = ticket.replies || []; return replies.length ? `<section class="dialog-section"><h3>Respostas da equipe</h3><div class="stack gap-sm">${replies.map(reply => `<article class="ticket-note"><strong>${esc(reply.author_name)}</strong><p>${esc(reply.message || 'Conteúdo removido pela política de retenção.')}</p><small>${date(reply.created_at, true)}</small></article>`).join('')}</div></section>` : ''; }
function deadlineNote(ticket) { if (ticket.status === 'awaiting_feedback') return `<small>Confirmação até ${date(ticket.feedback_deadline, true)}</small>`; if (ticket.replied_at) return `<small>Respondido em ${date(ticket.replied_at, true)}</small>`; if (state.user.role === 'attendant' && ticket.status === 'active' && ticket.response_due_at) { const late = new Date(ticket.response_due_at) < new Date(); return `<small class="${late ? 'negative-text' : ''}">${late ? 'Resposta vencida' : 'Responder até'} ${date(ticket.response_due_at, true)}</small>`; } return ''; }
function ticketsPage() {
  const attendant = state.user.role === 'attendant';
  const tickets = state.data.tickets;
  const alerts = attendant ? (state.data.notifications || []).filter(n => n.ticket_id && ['response', 'overdue', 'response_overdue', 'response_due', 'due_soon'].includes(n.type)) : [];
  const statusCell = t => attendant ? `<a class="status-link" href="#registrar?id=${t.id}" aria-label="Atualizar o status do atendimento ${esc(t.protocol)}">${badge(t.status)}<small class="status-hint">clique para atualizar</small></a>${deadlineNote(t)}` : `${badge(t.status)}${deadlineNote(t)}`;
  const cols = [{ h: 'Atendimento', cls: 'col-main' }, { h: 'Cliente' }, { h: 'Status' }, { h: 'Ação', cls: 'action-col' }];
  const rows = tickets.map(t => {
    const place = clientPlace(t);
    const details = `<dl class="mini-list"><dt>Canal</dt><dd>${esc(t.channel)}</dd><dt>Registrado</dt><dd>${date(t.created_at, true)}</dd>${!attendant ? `<dt>Atendente</dt><dd>${esc(t.attendant_name)}</dd>` : ''}${t.response_due_at ? `<dt>Responder até</dt><dd>${date(t.response_due_at, true)}</dd>` : ''}</dl>`;
    return [`<strong>${esc(t.protocol)}</strong>${ticketTags(t)}${clip(t.subject)}${more('Mais detalhes', details)}`, `${esc(t.client_name)}${place ? `<small>${esc(place)}</small>` : ''}`, statusCell(t), attendant ? link(`Atualizar ${icon('cab3b', 15)}`, `registrar?id=${t.id}`, 'text-link') : `<button class="text-link" data-action="ticket-detail" data-id="${t.id}">Ver atendimento →</button>`];
  });
  return `${alerts.length ? `<section class="attention-list" aria-label="Lembretes de resposta">${alerts.slice(0, 3).map(n => `<div class="attention-item ${new Date(n.due_at) < new Date() ? 'overdue' : ''}"><div><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p></div>${link('Responder →', `registrar?id=${n.ticket_id}`, 'text-link')}</div>`).join('')}</section>` : ''}<div class="section-head"><div><h2>Atendimentos e conexões</h2><p>${tickets.length} registros disponíveis para sua conta</p></div>${attendant ? link(`${icon('e485c')}Registrar atendimento`, 'registrar') : ''}</div><div class="card table-wrap">${tickets.length ? dtable(cols, rows) : empty('Nenhum atendimento por aqui.', 'Registre o primeiro atendimento para começar.')}</div>`;
}
function rating(name = 'rating', value = '') { return `<div class="rating-group" role="group" aria-label="Nota do atendimento, de 1 a 5">${[1, 2, 3, 4, 5].map(n => `<label class="rating-option"><input type="radio" name="${name}" value="${n}" aria-label="Nota ${n} de 5" ${Number(value) === n ? 'checked' : ''} required><span>${n}</span></label>`).join('')}</div>`; }
function statusFields() {
  return `${select('status', 'Status do atendimento', [['active', 'Em atendimento'], ['resolved', 'Resolvido']], 'active')}<div id="create-solution" class="full" hidden>${textarea('solution', 'Como o problema foi resolvido?', '', 'required minlength="10" maxlength="2000" rows="4" disabled', 'De 10 a 2000 caracteres. Descreva a solução aplicada.')}<div class="banner banner-warning compact"><p>A solução será enviada ao cliente para confirmação. A mudança manual de status não poderá ser repetida depois.</p></div></div>`;
}
function registerPage() {
  const ticket = state.data.tickets.find(t => Number(t.id) === Number(state.params.get('id')));
  if (state.params.has('id') && !ticket) return empty('Atendimento não encontrado.', 'Ele não está disponível no seu escopo de acesso.');
  const editing = Boolean(ticket);
  const locked = editing && ['resolved', 'closed_no_response'].includes(ticket.status);
  const quotaUsed = editing && (num(ticket.manual_status_changes) >= 1 || ticket.status !== 'active');
  state.selectedCategory = ticket?.category_id || null;
  const priority = ticket?.priority || 'medium';
  const priorityField = `<div class="field"><label for="priority">Prioridade</label><select id="priority" name="priority" required ${editing ? 'disabled' : ''}>${Object.entries(priorityNames).map(([value, label]) => `<option value="${value}" ${value === priority ? 'selected' : ''}>${label}</option>`).join('')}</select><small id="priority-hint">${editing && ticket.response_due_at ? `Responder ao cliente até ${date(ticket.response_due_at, true)}. ${esc(priorityHint(priority))}` : esc(priorityHint(priority))}</small></div>`;
  return `${editing ? `<div class="ticket-edit-head"><strong>${esc(ticket.protocol)}</strong>${badge(ticket.status)}${ticketTags(ticket)}<small class="status-quota ${quotaUsed ? 'used' : ''}">${quotaUsed ? 'Atualização já utilizada' : 'Atualização de status disponível uma vez'}</small><small>Registrado em ${date(ticket.created_at, true)}</small></div>` : ''}<section class="card form-card"><h2>${editing ? 'Tudo sobre esta conversa.' : 'Uma nova conversa começa aqui.'}</h2><p>${editing ? 'Atualize as informações e acompanhe a solução neste mesmo lugar.' : 'Vincule o atendimento a um cliente. Você será o atendente responsável.'}</p><form id="ticket-form" data-id="${ticket?.id || ''}"><div class="form-grid"><div class="field full"><label for="client_id">Cliente</label><select id="client_id" name="client_id" required ${editing ? 'disabled' : ''}><option value="">Selecione o cliente</option>${state.data.clients.map(c => `<option value="${c.id}" ${Number(ticket?.client_id) === Number(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div class="field full"><label for="subject">Assunto</label><div class="input-relative"><input id="subject" name="subject" value="${esc(ticket?.subject || '')}" placeholder="Comece a digitar, por exemplo: VPN" minlength="5" maxlength="180" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="subject-suggestions" required ${locked ? 'disabled' : ''}><div id="subject-suggestions" class="autocomplete-list" role="listbox" hidden></div></div><small>Busque assuntos e soluções já registrados no banco.</small></div>${select('channel', 'Canal', ['Portal', 'Telefone', 'E-mail', 'Chat'], ticket?.channel || 'Portal', locked ? 'disabled' : '')}${priorityField}${editing ? '' : statusFields()}</div><div id="related-cases" class="related-cases"></div><div class="form-actions"><small>${editing ? 'O status acompanha o fluxo de solução automaticamente.' : 'Registrado na sua equipe, sem etapas extras.'}</small>${locked ? '<span class="badge resolved">Registro encerrado</span>' : `<button type="submit" class="btn btn-primary">${editing ? 'Salvar alterações' : 'Registrar atendimento'} ${icon('2bccc', 15)}</button>`}</div></form></section>${editing ? solutionSection(ticket) : ''}`;
}
function clientsTable(query = '') {
  const counts = new Map();
  state.data.tickets.forEach(t => counts.set(Number(t.client_id), (counts.get(Number(t.client_id)) || 0) + 1));
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const clients = [...state.data.clients].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR')).filter(c => !needle || `${c.name} ${clientPlace({ client_id: c.id })}`.toLocaleLowerCase('pt-BR').includes(needle));
  if (!clients.length) return `<div class="card table-wrap">${empty(needle ? 'Nenhuma empresa encontrada.' : 'Nenhuma empresa cadastrada.', needle ? 'Tente outro nome ou cidade.' : 'O cadastro é feito no sistema de cadastro.')}</div>`;
  const cols = [{ h: 'Empresa', cls: 'col-main' }, { h: 'Cidade/UF' }, { h: 'Seus atendimentos' }];
  return `<div class="card table-wrap">${dtable(cols, clients.map(c => [`<strong>${esc(c.name)}</strong>`, esc(clientPlace({ client_id: c.id })) || 'Não informada', counts.get(Number(c.id)) || 0]))}</div>`;
}
function clientsPage() {
  return `<div class="banner compact"><p>Esta aba é somente consulta. O cadastro de empresas é feito no sistema de cadastro: <a href="/clientes/" target="_blank" rel="noopener">abrir o sistema de cadastro (nova aba)</a>. Depois de cadastrada, a empresa aparece no registro de atendimento.</p></div><div class="section-head"><div><h2>Empresas cadastradas</h2><p>${state.data.clients.length} empresas, com a contagem dos seus atendimentos em cada uma</p></div><div class="field client-search"><label for="client-search">Buscar empresa</label><input id="client-search" type="search" placeholder="Nome, cidade ou UF" autocomplete="off"></div></div><div id="clients-list">${clientsTable()}</div>`;
}
function solutionSection(ticket) {
  const manual = num(ticket.manual_status_changes);
  return `<section class="solution-section stack"><div class="card"><h3>Resposta ao cliente</h3><p class="small">Envie uma atualização sem precisar mudar o status.</p>${repliesBlock(ticket)}${ticket.status === 'active' ? `<form id="reply-form" data-id="${ticket.id}"><div class="form-grid">${textarea('message', 'Mensagem', '', 'required minlength="5" maxlength="2000" rows="3"', 'A mensagem fica disponível ao cliente no portal.')}</div><div class="form-actions"><small>${ticket.response_due_at ? `Prazo: ${date(ticket.response_due_at, true)}` : 'Resposta registrada neste atendimento.'}</small><button class="btn" type="submit">Enviar resposta ao cliente</button></div></form>` : ''}</div><div class="card"><h3>Solução e confirmação do cliente</h3>${ticket.solution ? `<div class="ticket-note" style="margin-top:15px">${esc(ticket.solution)}</div>` : ''}${ticket.status === 'active' && manual === 0 ? `<p class="small">Você envia a solução uma vez. O sistema cuida da confirmação e do encerramento.</p><form id="solution-form" data-id="${ticket.id}"><div class="form-grid">${textarea('solution', 'Como o problema foi resolvido?', '', 'required minlength="10" maxlength="2000" rows="4"', 'Descreva a solução aplicada antes de pedir a confirmação.')}</div><div class="form-actions"><small>O cliente terá 3 dias para responder. Sem retorno, o registro será encerrado como “sem retorno”.</small><button class="btn btn-primary" type="submit">Enviar solução e pedir confirmação</button></div></form>` : `<div class="banner compact ${ticket.status === 'active' ? 'banner-warning' : ''}"><p>${ticket.status === 'awaiting_feedback' ? `Solução enviada. Aguardando o cliente até ${date(ticket.feedback_deadline, true)}. O encerramento será automático após confirmação ou prazo de 3 dias sem retorno.` : ticket.status === 'active' && manual >= 1 ? 'O cliente informou que o problema continua. O atendimento permanece aberto. O supervisor pode revisar o caso e autorizar uma nova tentativa, com justificativa.' : ticket.status === 'resolved' ? 'O cliente confirmou que o problema foi resolvido. Atendimento encerrado com confirmação.' : 'Encerrado após 3 dias sem retorno do cliente. Este atendimento não é contabilizado como resolvido.'}</p></div>`}</div></section>`;
}
function caseCards(cases, apply = false) {
  if (!cases?.length) return `<div class="case-card"><p>Nenhum case de resolução correspondente foi encontrado no banco. A equipe poderá documentar uma solução validada para este problema.</p></div>`;
  const unique = [...new Map(cases.map(c => [`${c.subject}|${c.solution}`, c])).values()];
  return unique.slice(0, 3).map(c => `<article class="case-card"><div class="case-header"><h3>${esc(c.subject)}</h3></div><p>${esc(c.solution)}</p><div class="spread"><small class="case-meta">Case ${esc(c.id)}${c.usage_count ? ` · ${num(c.usage_count)} aplicações` : ''}</small>${apply ? `<button type="button" class="text-link" data-action="apply-case" data-id="${c.id}">Usar este assunto →</button>` : ''}</div></article>`).join('');
}
async function loadRelatedCases(query, ticketId) {
  const el = document.querySelector('#related-cases');
  if (!el) return;
  const currentSubject = query ?? document.querySelector('#subject')?.value ?? '';
  const id = ticketId || state.params.get('id');
  try {
    const result = await api(id && !query ? `/tickets/${id}/cases` : `/cases?q=${encodeURIComponent(currentSubject)}`);
    if (!document.contains(el)) return;
    const rawCases = Array.isArray(result) ? result : result.cases || [];
    const cases = [...new Map(rawCases.map(c => [`${c.subject}|${c.solution}`, c])).values()];
    state.caseResults = cases;
    el.innerHTML = `<h3>Soluções de quem já passou por isso</h3><p class="small">Cases de resolução registrados na base de conhecimento.</p>${caseCards(cases, true)}`;
    if (query !== undefined) {
      const list = document.querySelector('#subject-suggestions');
      if (!list) return;
      list.innerHTML = cases.slice(0, 5).map(c => `<button type="button" role="option" data-action="apply-case" data-id="${c.id}">${esc(c.subject)}<small>${esc(String(c.solution).slice(0, 100))}</small></button>`).join('');
      list.hidden = !cases.length || !query.trim();
      document.querySelector('#subject')?.setAttribute('aria-expanded', String(!list.hidden));
    }
  } catch (error) { if (document.contains(el)) el.innerHTML = `<p class="small">Não foi possível consultar os cases: ${esc(error.message)}</p>`; }
}
function filterClients() { if (state.user.role !== 'attendant') return state.data.clients; const present = new Set(state.data.tickets.map(t => Number(t.client_id))); return state.data.clients.filter(c => present.has(Number(c.id))); }
function filtersForm(compact = false) {
  if (state.user.role === 'manager') return dashFilters();
  const values = state.filters;
  const attendants = [...new Map(state.data.tickets.map(t => [t.attendant_id, { id: t.attendant_id, name: t.attendant_name }])).values()];
  const scopeFields = `${state.user.role === 'manager' ? select('team_id', 'Equipe', [['', 'Todas'], ...state.data.teams.map(t => [t.id, t.name])], values.team_id) : ''}${select('client_id', 'Cliente', [['', 'Todos'], ...filterClients().map(t => [t.id, t.name])], values.client_id)}${state.user.role !== 'attendant' ? select('attendant_id', 'Atendente', [['', 'Todos'], ...attendants.map(t => [t.id, t.name])], values.attendant_id) : ''}`;
  const search = `<div class="field filter-search"><label for="q">Assunto</label><input id="q" name="q" placeholder="Buscar" value="${esc(values.q || '')}"></div>`;
  const teamView = compact && state.user.role === 'supervisor';
  return `<form id="filters-form" class="card filters${teamView ? ' compact' : ''}">${input('from', 'De', 'date', values.from || '')}${input('to', 'Até', 'date', values.to || '')}${teamView ? scopeFields : ''}${select('channel', 'Canal', [['', 'Todos'], ...['Portal', 'Telefone', 'E-mail', 'Chat']], values.channel)}${select('mode', 'Origem', [['', 'Todas'], ['text', 'Texto'], ['audio', 'Áudio gravado'], ['quick', 'Avaliação rápida']], values.mode)}${select('sentiment', 'Sentimento', [['', 'Todos'], ...Object.entries(sentimentNames).filter(([v]) => v !== 'pending')], values.sentiment)}${teamView ? '' : search}${select('criticality', 'Criticidade', [['', 'Todas'], ['critical', 'Crítico'], ['regular', 'Regular']], values.criticality)}<div class="filter-actions"><button class="btn" type="submit">Aplicar filtros ${icon('13aa3', 15)}</button></div><details class="filter-advanced" ${values.team_id || values.client_id || values.attendant_id || (teamView && values.q) ? 'open' : ''}><summary>${teamView ? 'Filtrar por assunto' : state.user.role === 'manager' ? 'Filtrar por equipe, cliente e atendente' : 'Filtrar por cliente e atendente'}</summary><div class="filter-extra-fields">${teamView ? search : scopeFields}<button class="btn btn-ghost" type="button" data-action="clear-filters">Limpar filtros</button></div></details></form>`;
}
function filteredFeedbacks() {
  const f = state.filters;
  return state.data.feedbacks.filter(item => {
    if (f.from && item.created_at.slice(0, 10) < f.from) return false;
    if (f.to && item.created_at.slice(0, 10) > f.to) return false;
    if (f.sentiment && item.sentiment !== f.sentiment) return false;
    if (f.criticality && item.criticality !== f.criticality) return false;
    if (f.mode && item.mode !== f.mode) return false;
    if (f.q && !item.subject.toLocaleLowerCase('pt-BR').includes(f.q.toLocaleLowerCase('pt-BR'))) return false;
    const ticket = state.data.tickets.find(t => Number(t.id) === Number(item.ticket_id));
    if (f.team_id && Number(ticket?.team_id) !== Number(f.team_id)) return false;
    if (f.client_id && Number(ticket?.client_id) !== Number(f.client_id)) return false;
    if (f.attendant_id && Number(ticket?.attendant_id) !== Number(f.attendant_id)) return false;
    if (f.channel && ticket?.channel !== f.channel) return false;
    return true;
  });
}
function analysisStatus(feedback) {
  const labels = { pending: 'Na fila de análise', processing: 'Analisando relato', failed: 'Análise indisponível' };
  return labels[feedback.analysis_status] ? `<small class="analysis-status ${esc(feedback.analysis_status)}">${esc(labels[feedback.analysis_status])}</small>` : '';
}
function transcriptContent(feedback) {
  if (feedback.redacted_at) return '<div class="feedback-quote">Conteúdo removido pela política de retenção.</div>';
  const content = feedback.text || feedback.transcript || (feedback.mode === 'audio' ? 'A transcrição aparecerá aqui após o processamento. Você também pode ouvir a gravação.' : `Nota ${feedback.rating} de 5. ${feedback.resolved ? 'Cliente confirmou a solução.' : 'Cliente informou que o problema continua.'}`);
  return `${feedback.mode === 'audio' && feedback.transcript ? '<h3 class="transcript-heading">Transcrição automática</h3>' : ''}<div class="feedback-quote">${esc(content)}</div>${feedback.mode === 'audio' && feedback.transcript ? '<p class="small">A transcrição pode conter erros. Consulte a gravação antes de decidir.</p>' : ''}`;
}
function analysisContent(feedback) {
  const status = feedback.analysis_status;
  if (feedback.redacted_at) return '<h3>Análise automática original</h3><p class="small">Conteúdo removido pela política de retenção.</p>';
  if (status === 'pending' || status === 'processing') return `<h3>Análise automática original</h3><div class="analysis-progress" role="status"><span class="spinner" aria-hidden="true"></span><div><strong>${status === 'processing' ? 'Analisando seu relato' : 'Aguardando processamento'}</strong><p>${feedback.mode === 'audio' ? 'O áudio será transcrito e o sentimento será analisado.' : 'O sentimento do texto será analisado.'} O resultado aparece automaticamente, sem interromper sua revisão.</p></div></div>`;
  if (status === 'failed') return `<h3>Análise automática original</h3><div class="banner banner-warning compact" role="status"><div><strong>Não foi possível concluir a análise.</strong><p>Seu feedback foi preservado. A equipe pode ouvir ou ler o relato e solicitar outra tentativa.</p></div></div>${state.user.role === 'supervisor' ? `<button type="button" class="btn btn-small" data-action="retry-analysis" data-id="${num(feedback.id)}">Tentar análise novamente</button>` : ''}`;
  const source = feedback.analysis_source;
  const model = feedback.model || feedback.analysis_model;
  const hasModel = status === 'completed' && Boolean(model);
  const sentiment = feedback.original_sentiment || (feedback.reviewed ? null : feedback.sentiment);
  const criticality = feedback.original_criticality || (feedback.reviewed ? null : feedback.criticality);
  const summary = feedback.original_summary || (feedback.reviewed ? null : feedback.summary);
  const score = hasModel && feedback.confidence !== null && feedback.confidence !== undefined && Number.isFinite(Number(feedback.confidence)) ? `${Math.round(Math.min(1, Math.max(0, Number(feedback.confidence))) * 100)}%` : null;
  const topics = Array.isArray(feedback.topics) ? feedback.topics : [];
  const evidence = Array.isArray(feedback.evidence) ? feedback.evidence : [];
  return `<h3>Análise automática original</h3><div class="button-row">${sentiment ? badge(sentiment, sentimentNames) : '<span class="small">Classificação original não registrada.</span>'}${criticality ? badge(criticality, criticalityNames) : ''}</div><dl class="description-list"><dt>${hasModel ? 'Resumo extrativo' : 'Resumo'}</dt><dd>${esc(summary || 'Não registrado separadamente da revisão humana.')}</dd><dt>Assuntos</dt><dd>${topics.length ? topics.map(esc).join(', ') : 'Não identificados.'}</dd><dt>Evidências</dt><dd>${evidence.length ? evidence.map(item => `“${esc(item)}”`).join(', ') : 'Sem trechos de alerta identificados.'}</dd><dt>Score do modelo</dt><dd>${score || (source === 'rating' ? 'Não se aplica à avaliação por nota.' : 'Não disponível para este registro.')}</dd><dt>Confirmação</dt><dd>${feedback.resolved ? 'Cliente confirmou a solução.' : 'Cliente ainda precisa de ajuda.'}</dd></dl><p class="analysis-source">${hasModel ? `Sentimento por IA local: ${esc(model)}.${feedback.transcription_model ? ` Transcrição: ${esc(feedback.transcription_model)}.` : ''} Resumo, assuntos e alertas usam extração de trechos e regras locais. O score não é uma garantia de acerto.` : source === 'rating' ? 'Avaliação rápida: sentimento derivado da nota, sem inferência de IA.' : 'Registro de demonstração: classificação por regras locais.'}</p>`;
}
function analysisKey(feedback) { return JSON.stringify([feedback.id, feedback.analysis_status, feedback.transcript, feedback.original_sentiment, feedback.original_criticality, feedback.original_summary, feedback.summary, feedback.sentiment, feedback.criticality, feedback.reviewed, feedback.confidence, feedback.redacted_at]); }
function updateAnalysisViews() {
  const feedback = state.data.feedbacks.find(item => Number(item.id) === Number(state.modalFeedbackId));
  if (dialog.open && feedback) {
    const analysis = dialog.querySelector('#feedback-analysis');
    if (analysis) analysis.innerHTML = analysisContent(feedback);
    const transcript = dialog.querySelector('#feedback-transcript');
    if (transcript) transcript.innerHTML = transcriptContent(feedback);
    const clientStatus = dialog.querySelector('#client-analysis-status');
    if (clientStatus) clientStatus.innerHTML = analysisStatus(feedback);
  }
  const list = document.querySelector('#feedback-list');
  if (list) {
    const feedbacks = filteredFeedbacks().filter(item => state.route !== 'criticos' || item.criticality === 'critical');
    const template = document.createElement('template');
    template.innerHTML = feedbackTable(feedbacks);
    const replacement = template.content.firstElementChild;
    const scroll = list.scrollLeft;
    list.replaceWith(replacement);
    replacement.scrollLeft = scroll;
  }
}
async function updateAnalysisReport() {
  if (!document.querySelector('#report-results')) return;
  const data = state.data;
  const route = state.route;
  const report = await api(`/reports?${new URLSearchParams(state.filters)}`);
  if (state.data !== data || state.route !== route || activeMutations) return;
  state.report = report;
  const template = document.createElement('template');
  template.innerHTML = reportPage();
  const statisticsTarget = document.querySelector('.stats');
  const resultsTarget = document.querySelector('#report-results');
  if (statisticsTarget && template.content.querySelector('.stats')) statisticsTarget.replaceWith(template.content.querySelector('.stats'));
  if (resultsTarget) resultsTarget.replaceWith(template.content.querySelector('#report-results'));
  hydrateCharts();
}
function feedbackTable(feedbacks) {
  const client = state.user.role === 'client';
  const cols = [{ h: 'Feedback', cls: 'col-main' }, { h: 'Atendimento' }, ...(!client ? [{ h: 'Classificação' }] : []), { h: 'Ação', cls: 'action-col' }];
  const rows = feedbacks.map(f => {
    const ticket = state.data.tickets.find(t => Number(t.id) === Number(f.ticket_id));
    const preview = client ? esc(String(f.text || f.transcript || (f.mode === 'quick' ? `Nota ${f.rating} de 5` : 'Feedback em áudio')).slice(0, 52)) : esc(f.client_name);
    const details = `<dl class="mini-list"><dt>Origem</dt><dd>${esc(modeNames[f.mode] || f.mode)}${analysisStatus(f)}</dd><dt>Recebido em</dt><dd>${date(f.created_at, !client)}</dd></dl>`;
    return { cls: f.sentiment === 'negative' ? 'negative-row' : '', cells: [`<strong>${esc(f.protocol)}</strong>${ticketTags(ticket)}<small>${preview}</small>${more('Mais detalhes', details)}`, `${clip(f.subject)}${!client ? `<small>${esc(f.attendant_name)}</small>` : ''}`, ...(!client ? [`<div class="badge-stack">${badge(f.sentiment, sentimentNames)}${badge(f.criticality, criticalityNames)}</div>${f.reviewed ? '<small>Revisado</small>' : ''}`] : []), `<button class="text-link" data-action="feedback-detail" data-id="${f.id}">${state.user.role === 'supervisor' ? 'Revisar' : 'Ver detalhes'} ${icon('2f5af', 15)}</button>`] };
  });
  return `<div class="card table-wrap" id="feedback-list">${feedbacks.length ? dtable(cols, rows) : empty('Nenhum feedback encontrado.', 'Os registros aparecerão aqui quando o cliente compartilhar sua experiência.')}</div>`;
}
function feedbacksPage() { const feedbacks = filteredFeedbacks(); const supervisor = state.user.role === 'supervisor'; return `${state.user.role !== 'client' ? filtersForm(true) : ''}<div class="section-head"><div><h2>Cada feedback conta uma história</h2><p>${feedbacks.length} registros no seu escopo de acesso</p></div>${state.user.role === 'client' ? link(`Enviar feedback ${icon('9b528', 15)}`, 'enviar-feedback') : ''}</div>${supervisor ? '<div class="banner compact"><p>Estes são os feedbacks dos atendimentos da sua equipe. O sentimento vem do modelo local ou da revisão humana, e a origem mostra se o relato chegou por texto, áudio ou nota.</p></div>' : ''}${feedbackTable(feedbacks)}`; }
function criticalPage() { const items = filteredFeedbacks().filter(f => f.criticality === 'critical'); return `${filtersForm(true)}<div class="banner banner-warning compact">${icon('20913')}<p>Sinais automáticos precisam de avaliação humana. Sentimento negativo, por si só, não determina alta criticidade. Revise cada caso antes de confirmar a classificação.</p></div><div class="section-head"><div><h2>Um olhar atento faz a diferença</h2><p>${items.length} registros no seu escopo de acesso</p></div></div>${feedbackTable(items)}`; }
function decisionButtons(ticket) {
  return `<div class="decision-row" role="group" aria-label="Sua decisão sobre o atendimento ${esc(ticket.protocol)}">${btn('Resolveu, pode encerrar', 'decide', 'btn-primary', `data-id="${ticket.id}" data-resolved="1"`)}${btn('Ainda preciso de ajuda', 'decide', '', `data-id="${ticket.id}" data-resolved="0"`)}</div>`;
}
function decisionForm(ticket) {
  const resolved = state.decision.resolved === '1';
  return `<form id="feedback-form" data-ticket="${ticket.id}"><input type="hidden" name="ticket_id" value="${ticket.id}"><input type="hidden" name="resolved" value="${resolved ? '1' : '0'}"><div class="decision-chosen"><span class="badge ${resolved ? 'resolved' : 'critical'}">${resolved ? 'Resolveu, pode encerrar' : 'Ainda preciso de ajuda'}</span>${btn('Mudar decisão', 'decision-clear', 'btn-ghost')}</div><div class="form-grid"><div class="field full"><label>Qual nota você dá ao atendimento? (1 a 5)</label>${rating()}</div><div class="field full"><label>Quer contar mais? (opcional)</label><div class="mode-tabs"><button type="button" class="btn selected" data-action="feedback-mode" data-mode="text" aria-pressed="true">${icon('0b772')}Escrever</button><button type="button" class="btn" data-action="feedback-mode" data-mode="audio" aria-pressed="false">${icon('c1f96')}Gravar áudio</button></div><small>Escolha uma opção. Limpe o conteúdo para trocar de formato. Sem texto nem áudio, enviamos só a nota.</small></div><div id="feedback-content" class="field full">${textFeedbackContent()}</div></div><label class="confirmation"><input type="checkbox" name="confirmed" required><span>Revisei meu feedback e confirmo o envio.</span></label><div class="form-actions"><small>Sua resposta será registrada diretamente no atendimento.</small><button type="submit" class="btn btn-primary">Enviar feedback ${icon('32f8c', 15)}</button></div></form>`;
}
function clientTicketCard(ticket, awaiting) {
  const chosen = awaiting && state.decision && Number(state.decision.ticket) === Number(ticket.id);
  const solution = ticket.solution ? `<section class="dialog-section"><h3>Solução enviada pela equipe</h3><div class="ticket-note">${esc(ticket.solution)}</div></section>` : '';
  const footer = awaiting ? (chosen ? decisionForm(ticket) : `<div class="dialog-section"><h3>O problema foi resolvido?</h3>${decisionButtons(ticket)}</div>`) : '<p class="small" style="margin-top:16px">A equipe segue cuidando do seu caso. Quando houver uma solução, você confirma aqui.</p>';
  return `<article class="card ticket-card" data-ticket="${ticket.id}"><div class="ticket-card-head"><div><div class="eyebrow">${esc(ticket.protocol)}</div><h3>${esc(ticket.subject)}</h3><small>Atendente: ${esc(ticket.attendant_name)}</small></div>${badge(ticket.status)}</div>${solution}${repliesBlock(ticket)}<div style="margin-top:14px">${deadlineNote(ticket)}</div>${footer}</article>`;
}
function feedbackFormPage() {
  const awaiting = state.data.tickets.filter(canFeedback);
  const following = state.data.tickets.filter(t => t.status === 'active' && (t.replies || []).length);
  if (!awaiting.length && !following.length) return `<section class="card success-card"><div class="success-check">✓</div><h2>Está tudo em dia por aqui.</h2><p>Não há atendimentos esperando sua decisão. Obrigado por compartilhar sua experiência.</p>${link('Ver meus feedbacks', 'feedbacks')}</section>`;
  return `<div class="section-head"><div><h2>Sua decisão encerra ou reabre o atendimento</h2><p>${awaiting.length} aguardando sua confirmação${following.length ? ` · ${following.length} em atendimento` : ''}</p></div></div><div class="ticket-card-list">${awaiting.map(t => clientTicketCard(t, true)).join('')}${following.map(t => clientTicketCard(t, false)).join('')}</div>`;
}
function textFeedbackContent() { return `<label for="feedback-text">Seu feedback (opcional)</label><textarea id="feedback-text" name="text" rows="4" maxlength="500" placeholder="Em poucas palavras, conte como foi sua experiência."></textarea><small id="feedback-counter">0 de 500 caracteres · até 5 linhas</small><button type="button" class="text-link" data-action="clear-feedback">Limpar conteúdo e trocar formato</button>`; }
function audioFeedbackContent() { return `<div class="recording" id="recording-panel"><div class="recording-indicator" id="recording-time">Sua voz também importa.</div><p class="small">Grave um feedback de até 60 segundos. O microfone só será ativado ao iniciar.</p><div class="waveform" aria-hidden="true">${'<i></i>'.repeat(32)}</div><div id="audio-preview"></div><div class="button-row"><button type="button" class="btn" data-action="record-start" id="record-start">Iniciar gravação</button><button type="button" class="btn btn-danger" data-action="record-stop" id="record-stop" hidden>Parar gravação ${icon('13bd2', 15)}</button></div><p class="progress-note">Após o envio, o áudio será transcrito e analisado automaticamente neste computador. A equipe poderá revisar o resultado.</p></div><button type="button" class="text-link" data-action="clear-feedback">Descartar áudio e trocar formato</button>`; }
const priorityNames = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };
const priorityDeadline = { low: '8h', medium: '4h', high: '1h', critical: '30min' };
const priorityColors = { low: '#8fb3dd', medium: '#2b73d8', high: '#e8a04a', critical: '#b42318' };
const deadlineParts = [['on_time', 'No prazo', '#3f8f63'], ['late', 'Fora do prazo', '#e8a04a'], ['awaiting_on_time', 'Aguardando no prazo', '#6fa8e8'], ['overdue', 'Vencido', '#b42318']];
function priorityHint(priority) { return `Prazo para responder ao cliente: ${priorityDeadline[priority] || ''}, calculado pelo sistema a partir da prioridade.`; }
function levelBadge(level) { const n = num(level); return n ? `<span class="badge level level-${n}" title="Nível de suporte ${n}">N${n}</span>` : ''; }
function priorityBadge(priority) { return priority ? `<span class="badge prio prio-${esc(priority)}" title="Prazo de resposta: ${esc(priorityDeadline[priority] || '')}">${esc(priorityNames[priority] || priority)}</span>` : ''; }
function ticketTags(ticket) { const tags = `${levelBadge(ticket?.support_level)}${priorityBadge(ticket?.priority)}`; return tags ? `<span class="tags">${tags}</span>` : ''; }
function clientPlace(source) {
  const registered = state.data.clients.find(c => Number(c.id) === Number(source.client_id));
  const city = registered?.city ?? source.client_city ?? source.city;
  const uf = registered?.state ?? source.client_state ?? source.state;
  return city ? `${city}${uf ? `/${uf}` : ''}` : (uf || '');
}
function dtable(cols, rows, cls = '') {
  return `<table class="data-table ${cls}"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => { const plain = Array.isArray(row); return `<tr class="${plain ? '' : row.cls || ''}">${(plain ? row : row.cells).map((cell, i) => `<td data-label="${esc(cols[i].h)}" class="${cols[i].cls || ''}">${cell}</td>`).join('')}</tr>`; }).join('')}</tbody></table>`;
}
function more(label, body) { return `<details class="row-more"><summary>${esc(label)}</summary><div>${body}</div></details>`; }
function clip(text) { return `<span class="clip" title="${esc(text)}">${esc(text)}</span>`; }
function acc(title, subtitle, body, open = false) { return `<details class="card acc"${open ? ' open' : ''}><summary><span><strong>${esc(title)}</strong>${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</span></summary><div class="acc-body">${body}</div></details>`; }
function panel(title, subtitle, body, cls = '') { return `<section class="card chart-card ${cls}"><h3>${esc(title)}</h3><p>${esc(subtitle)}</p>${body}</section>`; }
function dashGrid(...panels) { return `<div class="dash-grid">${panels.join('')}</div>`; }
function legend(items) { return `<div class="legend">${items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join('')}</div>`; }
function stat(label, value, sub = '', type = '', file = '') { return `<article class="card stat"><div class="stat-label">${esc(label)}</div><div class="stat-value ${type === 'red' ? 'negative-text' : ''}">${esc(value)}</div><small>${sub}</small>${file ? `<span class="stat-icon ${type}">${icon(file)}</span>` : ''}</article>`; }
function kpi(label, value, sub, tone = '') { return `<article class="card stat kpi ${tone}"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><small>${esc(sub)}</small></article>`; }
function statistics(r) {
  const s = r.sentiments || {};
  const total = num(s.positive) + num(s.neutral) + num(s.negative);
  const negative = total ? Math.round(num(s.negative) / total * 100) : 0;
  const d = r.deadline;
  const answered = d ? num(d.on_time) + num(d.late) : 0;
  const onTime = answered ? `${Math.round(num(d.on_time) / answered * 100)}%` : 'n/d';
  return `<div class="stats stats-five">${kpi('Feedbacks recebidos', num(r.received), 'No período filtrado')}${kpi('Negativos', `${negative}%`, `${num(s.negative)} de ${total} analisados`, negative >= 30 ? 'warn' : '')}${kpi('Casos críticos', num(r.critical), 'Acompanhamento humano', 'danger')}${kpi('Respondidos no prazo', onTime, d ? `${num(d.on_time)} de ${answered} respondidos` : 'Sem dados de prazo')}${kpi('Atrasados', d ? num(d.overdue) : 'n/d', 'Prazo vencido sem resposta', 'danger')}</div>`;
}
function donutChart(parts, centerValue, centerLabel, label) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const total = parts.reduce((sum, p) => sum + num(p.value), 0);
  let offset = 0;
  const rings = total ? parts.filter(p => num(p.value) > 0).map(p => { const len = num(p.value) / total * C; const ring = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(p.label)}: ${num(p.value)}</title></circle>`; offset += len; return ring; }).join('') : '';
  return `<div class="donut-layout"><svg class="donut-svg" viewBox="0 0 120 120" role="img" aria-label="${esc(`${label}: ${parts.map(p => `${p.label} ${num(p.value)}`).join(', ')}`)}"><circle r="${R}" cx="60" cy="60" fill="none" stroke="#edf1f6" stroke-width="16"/>${rings}<text x="60" y="60" text-anchor="middle" class="svg-big">${esc(centerValue)}</text><text x="60" y="75" text-anchor="middle" class="svg-small">${esc(centerLabel)}</text></svg><div class="donut-legend">${parts.map(p => `<div><i style="background:${p.color}"></i><span>${esc(p.label)}</span><strong>${num(p.value)}${total ? ` <small>(${Math.round(num(p.value) / total * 100)}%)</small>` : ''}</strong></div>`).join('')}</div></div>`;
}
function columnChart(items, label) {
  const W = 320, H = 180, top = 24, bottom = 30, gap = 18;
  const n = items.length;
  const bw = (W - gap * (n + 1)) / n;
  const max = Math.max(...items.map(i => num(i.value)), 1);
  const bars = items.map((item, i) => { const h = (H - top - bottom) * num(item.value) / max; const x = gap + i * (bw + gap); const y = H - bottom - h; return `<g><title>${esc(item.label)}: ${num(item.value)}</title><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${item.color}"/><text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="svg-val">${num(item.value)}</text><text x="${(x + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="svg-axis">${esc(item.label)}</text></g>`; }).join('');
  return `<svg class="col-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${label}: ${items.map(i => `${i.label} ${num(i.value)}`).join(', ')}`)}"><line x1="8" x2="${W - 8}" y1="${H - bottom}" y2="${H - bottom}" stroke="#d3dce8"/>${bars}</svg>`;
}
function areaChart(points, label) {
  const W = 400, H = 180, l = 30, rgt = 10, t = 16, b = 26;
  const max = Math.max(...points.map(p => Math.max(num(p.value), num(p.second))), 1);
  const x = i => l + (W - l - rgt) * i / (points.length - 1);
  const y = v => H - b - (H - t - b) * v / max;
  const path = key => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(num(p[key])).toFixed(1)}`).join(' ');
  const grid = [0, .5, 1].map(f => `<line x1="${l}" x2="${W - rgt}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}" stroke="#edf1f6"/><text x="${l - 5}" y="${(y(max * f) + 3).toFixed(1)}" text-anchor="end" class="svg-axis">${Math.round(max * f)}</text>`).join('');
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(num(p.value)).toFixed(1)}" r="3" fill="#2b73d8"><title>${esc(p.label)}: ${num(p.value)} feedbacks, ${num(p.second)} negativos</title></circle>`).join('');
  return `<svg class="area-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${label}: ${points.map(p => `${p.label} ${num(p.value)}`).join(', ')}`)}">${grid}<path d="${path('value')} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z" fill="#2b73d8" opacity=".14"/><path d="${path('value')}" fill="none" stroke="#2b73d8" stroke-width="2"/><path d="${path('second')}" fill="none" stroke="#e49882" stroke-width="2" stroke-dasharray="4 3"/>${dots}<text x="${l}" y="${H - 6}" class="svg-axis">${esc(points[0].label)}</text><text x="${W - rgt}" y="${H - 6}" text-anchor="end" class="svg-axis">${esc(points.at(-1).label)}</text></svg>`;
}
function stackBar(parts, label) {
  const total = parts.reduce((sum, p) => sum + num(p.value), 0);
  if (!total) return empty('Ainda sem dados no período.');
  return `<div class="stackbar" role="img" aria-label="${esc(`${label}: ${parts.map(p => `${p.label} ${num(p.value)}`).join(', ')}`)}">${parts.map(p => { const pct = Math.round(num(p.value) / total * 100); return `<span style="width:${num(p.value) / total * 100}%;background:${p.color}" title="${esc(p.label)}: ${num(p.value)} (${pct}%)">${pct >= 9 ? `${pct}%` : ''}</span>`; }).join('')}</div><div class="legend">${parts.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)}: ${num(p.value)}</span>`).join('')}</div>`;
}
function levelHeat(r) {
  const levels = r.by_support_level || {};
  const values = ['1', '2', '3'].map(k => num(levels[k]));
  const total = values.reduce((a, b) => a + b, 0);
  const max = Math.max(...values, 1);
  return `<div class="heat" role="img" aria-label="${esc(`Atendimentos por nível de suporte: ${values.map((v, i) => `N${i + 1} ${v}`).join(', ')}`)}">${values.map((v, i) => `<div class="heat-cell" style="--a:${(0.1 + 0.8 * v / max).toFixed(2)}" data-strong="${v / max > 0.55}" title="N${i + 1}: ${v} atendimentos"><strong>N${i + 1}</strong><span>${v}</span><small>${total ? Math.round(v / total * 100) : 0}%</small></div>`).join('')}</div>`;
}
function scopedTickets() {
  const f = state.filters;
  return state.data.tickets.filter(t => (!f.from || t.created_at.slice(0, 10) >= f.from) && (!f.to || t.created_at.slice(0, 10) <= f.to) && (!f.team_id || Number(t.team_id) === Number(f.team_id)) && (!f.client_id || Number(t.client_id) === Number(f.client_id)) && (!f.attendant_id || Number(t.attendant_id) === Number(f.attendant_id)) && (!f.channel || t.channel === f.channel) && (!f.q || t.subject.toLocaleLowerCase('pt-BR').includes(f.q.toLocaleLowerCase('pt-BR'))));
}
function deadlinePanel(r, dark = false, cls = '') {
  const d = r.deadline;
  if (!d) return panel('Cumprimento do prazo', 'Prazo definido pela prioridade', empty('Sem dados de prazo ainda.'), cls);
  const parts = (dark ? dashDeadline : deadlineParts).map(([key, label, color]) => ({ label, value: num(d[key]), color }));
  return panel('Cumprimento do prazo', 'Prazo de resposta definido pela prioridade', donutChart(parts, num(d.total ?? parts.reduce((s, p) => s + p.value, 0)), 'atendimentos', 'Cumprimento do prazo'), cls);
}
function priorityPanel(r) {
  const p = r.by_priority || {};
  return panel('Atendimentos por prioridade', 'Baixa 8h, média 4h, alta 1h, crítica 30min', columnChart(Object.keys(priorityNames).map(k => ({ label: priorityNames[k], value: num(p[k]), color: priorityColors[k] })), 'Atendimentos por prioridade'));
}
function levelPanel(r) { return panel('Nível de suporte', 'Quanto cada nível concentra de atendimentos', levelHeat(r)); }
function sentimentPanel(r) {
  const s = r.sentiments || {};
  return panel('Distribuição de sentimentos', 'Classificações dos feedbacks analisados', stackBar([['positive', 'Positivo'], ['neutral', 'Neutro'], ['negative', 'Negativo']].map(([k, label]) => ({ label, value: num(s[k]), color: dashSentiment[k] })), 'Distribuição de sentimentos'));
}
function trendPanel(r) {
  const trend = r.trend || [];
  const points = trend.map(t => ({ label: shortDate(t.date), value: num(t.positive) + num(t.neutral) + num(t.negative), second: num(t.negative) }));
  const body = points.length >= 2 ? `${areaChart(points, 'Feedbacks por dia')}${legend([{ label: 'Feedbacks por dia', color: '#2b73d8' }, { label: 'Negativos', color: '#e49882' }])}` : points.length === 1 ? columnChart([{ label: points[0].label, value: points[0].value, color: '#2b73d8' }], 'Feedbacks no período') : empty('Ainda sem dados no período.');
  return panel('Evolução no tempo', 'Feedbacks recebidos por dia e quantos foram negativos', body, 'wide');
}
function topicCard(r) {
  const topics = (r.topics || []).slice(0, 5);
  const max = Math.max(...topics.map(t => num(t.count)), 1);
  return `<section class="card chart-card"><h3>Assuntos que mais aparecem</h3><p>Temas identificados nas análises</p>${topics.length ? topics.map(t => `<div class="topic-row"><div><span>${esc(t.subject)}</span><small>${num(t.count)} feedbacks</small></div><div class="topic-track"><span style="width:${num(t.count) / max * 100}%"></span></div></div>`).join('') : empty('Ainda sem assuntos para mostrar.')}</section>`;
}
function careCard(r) { return `<section class="card chart-card"><h3>Atenção que vira cuidado</h3><p>Acompanhe a resolução dos atendimentos</p><div class="care-stats"><div><strong>${num(r.awaiting_feedback)}</strong><small>Aguardando cliente</small></div><div><strong>${num(r.resolved)}</strong><small>Resolvidos</small></div><div><strong>${num(r.closed_no_response)}</strong><small>Sem retorno</small></div></div><div class="banner banner-warning compact"><p>Encerramentos sem retorno são separados de resoluções confirmadas pelo cliente.</p></div></section>`; }
function topicsAndCare(r) { return `<div class="chart-grid equal">${topicCard(r)}${careCard(r)}</div>`; }
function teamsTable(r) {
  if (!r.teams?.length) return empty('Nenhuma equipe neste período.');
  const maxOf = key => Math.max(...r.teams.map(t => num(t[key])), 1);
  const cols = [{ h: 'Equipe', cls: 'col-main' }, { h: 'Recebidos' }, { h: 'Críticos' }, { h: 'Resolvidos' }];
  const rows = r.teams.map(t => [`<strong>${esc(t.name)}</strong>${more('Mais números', `Analisados: ${num(t.analyzed)} · Positivos: ${num(t.positive)}`)}`, dataBar(num(t.received), maxOf('received'), 'blue'), dataBar(num(t.critical), maxOf('critical'), 'pink'), dataBar(num(t.resolved), maxOf('resolved'), 'green')]);
  return `<div class="table-wrap">${dtable(cols, rows, 'databar-table')}</div>`;
}
function shortDate(value) { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(value || ''); return m ? `${m[2]}/${m[1]}` : '?'; }
function comparisonStat(label, current, previous, suffix, worseWhenUp, relative, noBase) {
  const now = num(current);
  const before = num(previous);
  const diff = now - before;
  let change;
  if (noBase) change = '<span class="delta none">sem base de comparação</span>';
  else if (diff === 0) change = '<span class="delta same">→ sem variação</span>';
  else {
    const tone = !worseWhenUp ? 'neutral' : diff > 0 ? 'worse' : 'better';
    const amount = !relative ? `${Math.abs(diff)} p.p.` : before === 0 ? `${Math.abs(diff)}` : `${Math.abs(diff)} (${Math.abs(Math.round(diff / before * 100))}%)`;
    change = `<span class="delta ${tone}">${diff > 0 ? '↑ +' : '↓ -'}${amount}</span>`;
  }
  const top = Math.max(now, before, 1);
  const bars = `<div class="vs-bars" aria-hidden="true"><div class="vs-line"><em>Atual</em><span><i class="vs-now" style="width:${(now / top * 100).toFixed(1)}%"></i></span></div><div class="vs-line"><em>Anterior</em><span><i class="vs-prev" style="width:${(before / top * 100).toFixed(1)}%"></i></span></div></div>`;
  return `<article class="card stat comparison-stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${now}${suffix}</div><small>Antes: ${before}${suffix}</small> ${change}${bars}</article>`;
}
function comparisonBlock(r) {
  const c = r.comparison;
  const head = '<div class="section-head"><div><h2>Comparação com o período anterior</h2><p>O período atual contra a janela imediatamente anterior, de mesma duração.</p></div></div>';
  if (!c || !c.current || !c.previous) return `${head}${empty('Comparação indisponível', 'Ainda não há dados para comparar os períodos.')}`;
  const noBase = num(c.previous.received) === 0;
  const range = w => `${shortDate(w.from)} a ${shortDate(w.to)}`;
  return `${head}<div class="stats stats-three">${comparisonStat('Feedbacks recebidos', c.current.received, c.previous.received, '', false, true, noBase)}${comparisonStat('Percentual de negativos', c.current.negative_percent, c.previous.negative_percent, '%', true, false, noBase)}${comparisonStat('Casos críticos', c.current.critical, c.previous.critical, '', true, true, noBase)}</div><p class="report-note comparison-windows">De ${range(c.current)} contra ${range(c.previous)}</p>`;
}
const dashSentiment = { positive: '#34d399', neutral: '#fbbf24', negative: '#ff6b9a' };
const dashPriority = { low: '#7dd3fc', medium: '#4c9bff', high: '#fbbf24', critical: '#ff6b9a' };
const dashDeadline = [['on_time', 'No prazo', '#34d399'], ['late', 'Fora do prazo', '#fbbf24'], ['awaiting_on_time', 'Aguardando no prazo', '#60a5fa'], ['overdue', 'Vencido', '#ff5c7a']];
const dashPalette = ['#4c9bff', '#34d399', '#ff6b9a', '#fbbf24', '#a78bfa', '#7dd3fc'];
let chartSeq = 0;
function mixColor(from, to, t) {
  const a = [1, 3, 5].map(i => parseInt(from.slice(i, i + 2), 16));
  const b = [1, 3, 5].map(i => parseInt(to.slice(i, i + 2), 16));
  const k = Math.min(1, Math.max(0, t));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}
function dashTickets() {
  const f = state.filters;
  const tickets = scopedTickets();
  if (!(f.sentiment || f.criticality || f.mode)) return tickets;
  const ids = new Set(filteredFeedbacks().map(item => Number(item.ticket_id)));
  return tickets.filter(t => ids.has(Number(t.id)));
}
function ticketMap() { return new Map(state.data.tickets.map(t => [Number(t.id), t])); }
function trendSeries(r) {
  return (r.trend || []).map(t => ({ date: t.date, label: shortDate(t.date), positive: num(t.positive), neutral: num(t.neutral), negative: num(t.negative), total: num(t.positive) + num(t.neutral) + num(t.negative) }));
}
function bucketSeries(series, mode) {
  if (!series.length) return [];
  const DAY = 86400000;
  const stamp = d => Date.parse(`${d}T12:00:00Z`);
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const startOf = t => (mode === 'week' ? t - ((new Date(t).getUTCDay() + 6) % 7) * DAY : t);
  const step = mode === 'week' ? 7 * DAY : DAY;
  const buckets = new Map();
  series.forEach(p => { const k = startOf(stamp(p.date)); const b = buckets.get(k) || { positive: 0, neutral: 0, negative: 0 }; b.positive += p.positive; b.neutral += p.neutral; b.negative += p.negative; buckets.set(k, b); });
  const keys = [...buckets.keys()];
  const first = Math.min(...keys), last = Math.max(...keys);
  const out = [];
  for (let t = first; t <= last; t += step) {
    const b = buckets.get(t) || { positive: 0, neutral: 0, negative: 0 };
    const start = iso(t), end = iso(t + step - DAY);
    out.push({ date: start, label: shortDate(start), range: mode === 'week' ? `${shortDate(start)} a ${shortDate(end)}` : shortDate(start), title: mode === 'week' ? `Semana de ${shortDate(start)} a ${shortDate(end)}` : date(start), ...b, total: b.positive + b.neutral + b.negative });
  }
  return out;
}
function defaultMode(series) {
  if (series.length < 2) return 'day';
  return (Date.parse(`${series.at(-1).date}T12:00:00Z`) - Date.parse(`${series[0].date}T12:00:00Z`)) / 86400000 > 28 ? 'week' : 'day';
}
function peakOf(series, key) { return series.reduce((best, p) => (!best || p[key] > best[key] ? p : best), null); }
function splinePath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1].x - pts[i].x; m[i] = (pts[i + 1].y - pts[i].y) / dx[i]; }
  const t = new Array(n);
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; d += ` C${(pts[i].x + h).toFixed(1)},${(pts[i].y + t[i] * h).toFixed(1)} ${(pts[i + 1].x - h).toFixed(1)},${(pts[i + 1].y - t[i + 1] * h).toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`; }
  return d;
}
function niceScale(max, steps = 4) {
  const raw = Math.max(max, 1) / steps;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow);
  return { step, top: Math.ceil(Math.max(max, 1) / step) * step };
}
const iconPaths = {
  chat: '<path d="M8 10h48a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H30L16 58V48H8a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6z"/><path d="M14 22h36M14 32h24" stroke="#000" stroke-width="4" stroke-linecap="round" fill="none" opacity=".35"/>',
  smile: '<circle cx="32" cy="32" r="29"/><circle cx="23" cy="26" r="3.6" fill="#000" opacity=".4"/><circle cx="41" cy="26" r="3.6" fill="#000" opacity=".4"/><path d="M19 38c3 8 23 8 26 0" stroke="#000" stroke-width="4" stroke-linecap="round" fill="none" opacity=".4"/>',
  frown: '<circle cx="32" cy="32" r="29"/><circle cx="23" cy="26" r="3.6" fill="#000" opacity=".4"/><circle cx="41" cy="26" r="3.6" fill="#000" opacity=".4"/><path d="M19 45c3-8 23-8 26 0" stroke="#000" stroke-width="4" stroke-linecap="round" fill="none" opacity=".4"/>'
};
function miniArea(values, labels, label) {
  const n = values.length;
  const W = 300, H = 100, top = 14;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => ({ x: W * i / (n - 1), y: H - (H - top) * v / max }));
  const line = splinePath(pts);
  const peak = values.indexOf(Math.max(...values));
  const id = `mini${++chartSeq}`;
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return `<div class="hero-chart" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path class="hero-fill" d="${line} L${W},${H} L0,${H} Z" fill="url(#${id})"/><path class="hero-line" d="${line}" pathLength="1"/></svg><span class="hero-peak" style="left:${(pts[peak].x / W * 100).toFixed(1)}%;top:${(pts[peak].y / H * 100).toFixed(1)}%"></span></div><div class="hero-axis" aria-hidden="true">${ticks.map(i => `<span>${esc(labels[i])}</span>`).join('')}</div>`;
}
function heroCard(tone, title, value, chip, sub, series, key, iconKey) {
  const body = series.length >= 2 ? miniArea(series.map(p => p[key]), series.map(p => p.label), `${title} por ${series.length && series[1] && series[1].range.includes(' a ') ? 'semana' : 'dia'}, de ${series[0].label} a ${series.at(-1).label}: ${series.map(p => `${p.label} ${p[key]}`).join(', ')}`) : `<p class="hero-empty">Ainda não há dias suficientes para desenhar a curva.</p>`;
  return `<article class="hero hero-${tone}"><svg class="hero-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="currentColor">${iconPaths[iconKey]}</svg><div class="hero-head"><h3>${esc(title)}</h3>${chip ? `<span class="hero-chip">${esc(chip)}</span>` : ''}</div><div class="hero-value">${esc(value)}</div><p class="hero-sub">${esc(sub)}</p>${body}</article>`;
}
function heroCards(r) {
  const raw = trendSeries(r);
  const mode = defaultMode(raw);
  const series = bucketSeries(raw, mode);
  const s = r.sentiments || {};
  const analyzed = num(s.positive) + num(s.neutral) + num(s.negative);
  const pct = n => analyzed ? `${Math.round(num(n) / analyzed * 100)}% dos analisados` : '';
  const day = (key, word, noun) => { const p = peakOf(series, key); return p && p[key] > 0 ? `${word.replace('dia', mode === 'week' ? 'semana' : 'dia')}: ${p.range} (${p[key]} ${noun})` : null; };
  return `<section class="hero-row" aria-label="Destaques do período">${heroCard('blue', 'Feedbacks recebidos', num(r.received), '', day('total', 'Melhor dia', 'feedbacks') || (num(r.received) ? 'Série diária indisponível' : 'Nenhum feedback no período'), series, 'total', 'chat')}${heroCard('green', 'Positivos', num(s.positive), pct(s.positive), day('positive', 'Melhor dia', 'positivos') || 'Nenhum positivo no período', series, 'positive', 'smile')}${heroCard('pink', 'Negativos', num(s.negative), pct(s.negative), day('negative', 'Pior dia', 'negativos') || 'Nenhum negativo no período', series, 'negative', 'frown')}</section>`;
}
function kpiStrip(r, withReceived = false) {
  const d = r.deadline;
  const items = [...(withReceived ? [['Feedbacks recebidos', num(r.received), 'No período filtrado', 'blue']] : []), ['Casos críticos', num(r.critical), 'Acompanhamento humano', 'pink'], ['Atrasados', d ? num(d.overdue) : 'n/d', 'Prazo vencido sem resposta', 'pink'], ['Resolvidos', num(r.resolved), 'Confirmados pelo cliente', 'green'], ['Aguardando cliente', num(r.awaiting_feedback), 'Solução enviada', 'amber']];
  return `<section class="kpi-strip" aria-label="Indicadores do período">${items.map(([label, value, sub, tone]) => `<div class="strip-item"><span class="strip-label"><i class="dot-${tone}"></i>${esc(label)}</span><strong class="stat-value">${esc(value)}</strong><small>${esc(sub)}</small></div>`).join('')}</section>`;
}
function dataBar(value, max, tone, text = value) {
  const width = max && value ? Math.max(5, value / max * 100) : 0;
  return `<div class="databar"><span class="databar-fill ${tone}" style="width:${width.toFixed(1)}%"></span><b>${esc(text)}</b></div>`;
}
function channelStats() {
  const tickets = ticketMap();
  const rows = new Map();
  filteredFeedbacks().forEach(f => {
    const channel = tickets.get(Number(f.ticket_id))?.channel || 'Não informado';
    const row = rows.get(channel) || { label: channel, received: 0, negative: 0 };
    row.received++;
    if (f.sentiment === 'negative') row.negative++;
    rows.set(channel, row);
  });
  return [...rows.values()].sort((a, b) => b.received - a.received);
}
function channelTablePanel() {
  const rows = channelStats();
  if (!rows.length) return panel('Canais de atendimento', 'Feedbacks recebidos e negativos por canal', empty('Ainda sem dados no período.'), 's7');
  const maxR = Math.max(...rows.map(x => x.received), 1);
  const maxN = Math.max(...rows.map(x => x.negative), 1);
  const cols = [{ h: 'Canal', cls: 'col-main' }, { h: 'Recebidos' }, { h: 'Negativos' }, { h: '% negativos' }];
  const body = dtable(cols, rows.map(x => { const p = Math.round(x.negative / x.received * 100); return [`<strong>${esc(x.label)}</strong>`, dataBar(x.received, maxR, 'blue'), dataBar(x.negative, maxN, 'pink'), `<span class="pct-cell" style="background:${mixColor('#17356a', '#cf2f7a', p / 100)}">${p}%</span>`]; }), 'databar-table');
  return panel('Canais de atendimento', 'Feedbacks recebidos e negativos por canal', `<div class="table-wrap">${body}</div>`, 's7');
}
function prioritySentimentPanel() {
  const tickets = ticketMap();
  const counts = Object.fromEntries(Object.keys(priorityNames).map(k => [k, { positive: 0, neutral: 0, negative: 0 }]));
  filteredFeedbacks().forEach(f => { const p = tickets.get(Number(f.ticket_id))?.priority; if (counts[p] && counts[p][f.sentiment] !== undefined) counts[p][f.sentiment]++; });
  const order = ['critical', 'high', 'medium', 'low'];
  const totals = order.map(k => counts[k].positive + counts[k].neutral + counts[k].negative);
  const max = Math.max(...totals, 0);
  const sub = 'Sentimento dos feedbacks em cada prioridade de atendimento';
  if (!max) return panel('Prioridade e sentimento', sub, empty('Ainda sem dados no período.'), 's5');
  const summary = order.map((k, i) => `${priorityNames[k]}: ${counts[k].positive} positivos, ${counts[k].neutral} neutros, ${counts[k].negative} negativos`).join('; ');
  const rows = order.map((k, i) => `<div class="sbar"><span class="sbar-label">${priorityNames[k]}</span><span class="sbar-track"><span class="sbar-fill" style="width:${(totals[i] / max * 100).toFixed(1)}%">${['positive', 'neutral', 'negative'].filter(s => counts[k][s]).map(s => `<span style="flex:${counts[k][s]};background:${dashSentiment[s]}" title="${esc(`${priorityNames[k]}, ${sentimentNames[s]}: ${counts[k][s]}`)}">${counts[k][s] / totals[i] >= .14 ? counts[k][s] : ''}</span>`).join('')}</span></span><b>${totals[i]}</b></div>`).join('');
  return panel('Prioridade e sentimento', sub, `<div class="sbars" role="img" aria-label="${esc(`Feedbacks por prioridade e sentimento. ${summary}`)}">${rows}</div>${legend(['positive', 'neutral', 'negative'].map(s => ({ label: sentimentNames[s], color: dashSentiment[s] })))}`, 's5');
}
function gaugePanel(r) {
  const d = r.deadline;
  const answered = d ? num(d.on_time) + num(d.late) : 0;
  const sub = 'Atendimentos respondidos dentro do prazo da prioridade';
  if (!answered) return panel('Respondidos no prazo', sub, empty('Sem atendimentos respondidos ainda.'), 's4');
  const pct = Math.round(num(d.on_time) / answered * 100);
  const id = `gauge${++chartSeq}`;
  const arc = 'M20,100 A80,80 0 0 1 180,100';
  return panel('Respondidos no prazo', sub, `<div class="gauge"><svg class="gauge-svg" viewBox="0 0 200 124" role="img" aria-label="${esc(`${pct}% respondidos no prazo, ${num(d.on_time)} de ${answered} respondidos`)}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff6b9a"/><stop offset=".5" stop-color="#fbbf24"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs><path class="gauge-track" d="${arc}" pathLength="100"/><path class="gauge-bar" d="${arc}" pathLength="100" stroke="url(#${id})" stroke-dasharray="${pct} 100"/><text x="100" y="88" text-anchor="middle" class="gauge-num">${pct}%</text><text x="100" y="108" text-anchor="middle" class="svg-small">${num(d.on_time)} de ${answered} respondidos</text><text x="20" y="120" text-anchor="middle" class="svg-small">0</text><text x="180" y="120" text-anchor="middle" class="svg-small">100</text></svg></div>`, 's4');
}
function levelPriorityHeat() {
  const tickets = dashTickets();
  const keys = Object.keys(priorityNames);
  const cell = (level, p) => tickets.filter(t => num(t.support_level) === level && t.priority === p).length;
  const grid = [1, 2, 3].map(level => keys.map(p => cell(level, p)));
  const max = Math.max(...grid.flat(), 1);
  const summary = grid.map((row, i) => `N${i + 1}: ${row.map((v, j) => `${priorityNames[keys[j]]} ${v}`).join(', ')}`).join('; ');
  const body = `<div class="heatmap" role="img" aria-label="${esc(`Atendimentos por nível de suporte e prioridade. ${summary}`)}"><span></span>${keys.map(p => `<span class="heat-col">${priorityNames[p]}</span>`).join('')}${grid.map((row, i) => `<span class="heat-row">N${i + 1}</span>${row.map((v, j) => `<span class="heat-box" style="background:${mixColor('#142d5c', '#2870e0', v / max)};${v ? '' : 'color:#8ea3c9'}" title="${esc(`N${i + 1}, ${priorityNames[keys[j]]}: ${v} atendimentos`)}">${v}</span>`).join('')}`).join('')}</div>`;
  return panel('Nível de suporte', 'Atendimentos por nível e prioridade', body, 's4');
}
function overviewPage(r) {
  return `${heroCards(r)}${kpiStrip(r)}<div class="dash-12">${channelTablePanel()}${prioritySentimentPanel()}${gaugePanel(r)}${deadlinePanel(r, true, 's4')}${levelPriorityHeat()}</div><p class="dash-link">${link(`Ver comparação entre equipes ${icon('2f5af', 15)}`, 'equipes', 'text-link')}</p>`;
}
function evoDims(width) { const W = Math.max(280, Math.round(width || 720)); return { W, H: W < 480 ? 250 : 310, l: 38, r: 18, t: 34, b: 34 }; }
function buildEvolution(series, width) {
  const { W, H, l, r, t, b } = evoDims(width);
  const id = `evo${++chartSeq}`;
  const n = series.length;
  const times = series.map(p => Date.parse(`${p.date}T12:00:00Z`));
  const span = Math.max(times[n - 1] - times[0], 1);
  const { step, top } = niceScale(Math.max(...series.map(p => p.total), 1));
  const x = i => l + (W - l - r) * (times[i] - times[0]) / span;
  const y = v => H - b - (H - t - b) * v / top;
  const grid = [];
  for (let v = 0; v <= top; v += step) grid.push(`<line x1="${l}" x2="${W - r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${v ? 'evo-grid' : 'evo-base'}"/><text x="${l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="evo-tick">${v}</text>`);
  const labels = [];
  for (let i = 0; i < n; i++) if (!labels.length || x(i) - x(labels.at(-1)) >= 58) labels.push(i);
  if (labels.at(-1) !== n - 1) { if (x(n - 1) - x(labels.at(-1)) >= 58) labels.push(n - 1); else labels[labels.length - 1] = n - 1; }
  const xAxis = labels.map(i => `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="evo-tick">${esc(series[i].label)}</text>`).join('');
  const pts1 = series.map((p, i) => ({ x: x(i), y: y(p.total) }));
  const pts2 = series.map((p, i) => ({ x: x(i), y: y(p.negative) }));
  const line1 = splinePath(pts1), line2 = splinePath(pts2);
  const peak = peakOf(series, 'total');
  const pi = series.indexOf(peak);
  const text = `Pico: ${peak.total} (${peak.range})`;
  const bw = text.length * 6.6 + 18;
  const bx = Math.min(Math.max(pts1[pi].x - bw / 2, l), W - r - bw);
  const flip = pts1[pi].y - 40 < 4;
  const by = flip ? pts1[pi].y + 16 : pts1[pi].y - 40;
  const dots = n <= 45;
  const dotsMarkup = (pts, cls, key) => dots ? pts.map((p, i) => `<circle class="${cls}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${cls === 'evo-dot' ? 4 : 3.2}"><title>${esc(`${series[i].range}: ${series[i][key]} ${key === 'total' ? 'feedbacks' : 'negativos'}`)}</title></circle>`).join('') : '';
  const svg = `<svg class="evo-svg area-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Evolução de feedbacks por ${series[1].range.includes(' a ') ? 'semana' : 'dia'}, de ${series[0].label} a ${series[n - 1].label}. ${n} pontos, ${series.reduce((s, p) => s + p.total, 0)} feedbacks e ${series.reduce((s, p) => s + p.negative, 0)} negativos. Pico de ${peak.total} em ${peak.range}.`)}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c9bff" stop-opacity=".5"/><stop offset=".7" stop-color="#4c9bff" stop-opacity=".1"/><stop offset="1" stop-color="#4c9bff" stop-opacity="0"/></linearGradient></defs>${grid.join('')}${xAxis}<path class="evo-area" d="${line1} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z" fill="url(#${id})"/><path class="evo-line evo-line-total" d="${line1}" pathLength="1"/><path class="evo-line evo-line-neg" d="${line2}" pathLength="1"/><g class="evo-hover"><line class="evo-cross" y1="${t - 6}" y2="${y(0).toFixed(1)}"/><circle class="evo-hot evo-hot-total" r="6"/><circle class="evo-hot evo-hot-neg" r="5"/></g><g class="evo-dots">${dotsMarkup(pts2, 'evo-dot-neg', 'negative')}${dotsMarkup(pts1, 'evo-dot', 'total')}</g><g class="evo-peak"><circle cx="${pts1[pi].x.toFixed(1)}" cy="${pts1[pi].y.toFixed(1)}" r="8" class="evo-ring"/><line x1="${pts1[pi].x.toFixed(1)}" x2="${pts1[pi].x.toFixed(1)}" y1="${(flip ? pts1[pi].y + 8 : pts1[pi].y - 9).toFixed(1)}" y2="${(flip ? by : by + 24).toFixed(1)}" class="evo-lead"/><rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="24" rx="8" class="evo-flag"/><text x="${(bx + bw / 2).toFixed(1)}" y="${(by + 16).toFixed(1)}" text-anchor="middle" class="evo-flag-text">${esc(text)}</text></g></svg>`;
  return { svg, geom: { W, H, pts1, pts2 } };
}
function drawEvolution(wrap) {
  const series = bucketSeries(JSON.parse(wrap.dataset.raw), wrap.dataset.mode);
  const width = wrap.clientWidth || 720;
  const first = !wrap.dataset.drawn;
  const { svg, geom } = buildEvolution(series, width);
  wrap._series = series;
  const panelEl = wrap.closest('.evo-panel');
  panelEl.querySelector('.evo-data tbody').innerHTML = series.map(p => `<tr><td>${esc(p.title)}</td><td>${p.total}</td><td>${p.negative}</td><td>${p.total ? Math.round(p.negative / p.total * 100) : 0}%</td></tr>`).join('');
  panelEl.querySelector('.evo-sub').textContent = `Feedbacks recebidos por ${wrap.dataset.mode === 'week' ? 'semana' : 'dia'} e quantos foram negativos`;
  panelEl.querySelectorAll('[data-action="evo-mode"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === wrap.dataset.mode)));
  wrap.dataset.drawn = '1';
  wrap._w = width;
  wrap._geom = geom;
  wrap.classList.toggle('anim', first);
  wrap.querySelector('.evo-stage').innerHTML = svg;
}
const evoObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => entries.forEach(entry => {
  const wrap = entry.target;
  if (!wrap.isConnected) { evoObserver.unobserve(wrap); return; }
  if (Math.abs(Math.round(entry.contentRect.width) - (wrap._w || 0)) > 24) drawEvolution(wrap);
})) : null;
function hydrateCharts() {
  document.querySelectorAll('.evo-wrap').forEach(wrap => { drawEvolution(wrap); evoObserver?.observe(wrap); });
}
function showReport() { document.querySelector('#page-content').innerHTML = reportPage(); hydrateCharts(); }
function evoHide(wrap) {
  wrap.querySelector('.evo-tip').hidden = true;
  wrap.querySelectorAll('.evo-hover').forEach(g => g.classList.remove('on'));
}
function evoMove(event) {
  const svg = event.target.closest?.('.evo-svg');
  if (!svg) { document.querySelectorAll('.evo-tip:not([hidden])').forEach(tip => evoHide(tip.closest('.evo-wrap'))); return; }
  const wrap = svg.closest('.evo-wrap');
  const geom = wrap._geom;
  if (!geom) return;
  const series = wrap._series;
  const rect = svg.getBoundingClientRect();
  const scale = geom.W / rect.width;
  const px = (event.clientX - rect.left) * scale;
  let best = 0;
  geom.pts1.forEach((p, i) => { if (Math.abs(p.x - px) < Math.abs(geom.pts1[best].x - px)) best = i; });
  const p = series[best], a = geom.pts1[best], c = geom.pts2[best];
  const g = svg.querySelector('.evo-hover');
  g.classList.add('on');
  g.querySelector('.evo-cross').setAttribute('x1', a.x.toFixed(1));
  g.querySelector('.evo-cross').setAttribute('x2', a.x.toFixed(1));
  g.querySelector('.evo-hot-total').setAttribute('cx', a.x.toFixed(1));
  g.querySelector('.evo-hot-total').setAttribute('cy', a.y.toFixed(1));
  g.querySelector('.evo-hot-neg').setAttribute('cx', c.x.toFixed(1));
  g.querySelector('.evo-hot-neg').setAttribute('cy', c.y.toFixed(1));
  const tip = wrap.querySelector('.evo-tip');
  const share = p.total ? Math.round(p.negative / p.total * 100) : 0;
  tip.innerHTML = `<strong>${esc(p.title)}</strong><span><i style="background:#4c9bff"></i>Feedbacks: <b>${p.total}</b></span><span><i style="background:#ff6b9a"></i>Negativos: <b>${p.negative}</b> (${share}%)</span>`;
  tip.hidden = false;
  const svgBox = svg.getBoundingClientRect(), wrapBox = wrap.getBoundingClientRect();
  const left = (a.x / scale) + (svgBox.left - wrapBox.left);
  const topPx = (Math.min(a.y, c.y) / scale) + (svgBox.top - wrapBox.top);
  tip.style.left = `${Math.min(Math.max(left, tip.offsetWidth / 2 + 4), wrapBox.width - tip.offsetWidth / 2 - 4)}px`;
  tip.style.top = `${Math.max(topPx - 14, tip.offsetHeight + 6)}px`;
}
document.addEventListener('pointermove', evoMove);
document.addEventListener('pointerdown', evoMove);
document.addEventListener('pointerout', event => { if (!event.relatedTarget?.closest?.('.evo-svg')) document.querySelectorAll('.evo-tip:not([hidden])').forEach(tip => evoHide(tip.closest('.evo-wrap'))); });
function evolutionPanel(r) {
  const raw = trendSeries(r);
  if (raw.length < 2) {
    const only = raw[0];
    return panel('Evolução no tempo', 'Feedbacks recebidos por dia e quantos foram negativos', empty('Ainda não há série suficiente para o gráfico.', only ? `Só existe um dia com feedbacks no período (${only.label}, ${only.total} no total). O gráfico precisa de pelo menos 2 dias.` : 'Nenhum feedback no período filtrado.'), 'wide evo-panel');
  }
  const mode = defaultMode(raw);
  const modes = `<div class="evo-mode" role="group" aria-label="Agrupar o gráfico por">${[['day', 'Dia'], ['week', 'Semana']].map(([m, label]) => `<button type="button" data-action="evo-mode" data-mode="${m}" aria-pressed="${m === mode}">${label}</button>`).join('')}</div>`;
  const body = `<div class="evo-head">${legend([{ label: 'Feedbacks', color: '#4c9bff' }, { label: 'Negativos', color: '#ff6b9a' }])}${modes}</div><div class="evo-wrap" data-raw="${esc(JSON.stringify(raw))}" data-mode="${mode}"><div class="evo-stage"></div><div class="evo-tip" hidden role="status"></div></div><details class="evo-data"><summary>Ver os dados do gráfico em tabela</summary><table class="series-table"><thead><tr><th>Período</th><th>Feedbacks</th><th>Negativos</th><th>% negativos</th></tr></thead><tbody></tbody></table></details>`;
  return `<section class="card chart-card wide evo-panel"><h3>Evolução no tempo</h3><p class="evo-sub">Feedbacks recebidos por dia e quantos foram negativos</p>${body}</section>`;
}
function setEvoMode(button) {
  const wrap = button.closest('.evo-panel').querySelector('.evo-wrap');
  wrap.dataset.mode = button.dataset.mode;
  delete wrap.dataset.drawn;
  drawEvolution(wrap);
}
function statusPanel(r) {
  const parts = [['active', 'Em atendimento', '#4c9bff'], ['awaiting_feedback', 'Aguardando cliente', '#fbbf24'], ['resolved', 'Resolvidos', '#34d399'], ['closed_no_response', 'Sem retorno', '#ff6b9a']].map(([k, label, color]) => ({ label, value: num(r[k]), color }));
  return panel('Andamento dos atendimentos', 'Encerramentos sem retorno não contam como resolvidos', donutChart(parts, num(r.total_tickets), 'atendimentos', 'Andamento dos atendimentos'));
}
function sentimentNumbers(r) {
  const s = r.sentiments || {};
  const total = num(s.positive) + num(s.neutral) + num(s.negative);
  return `<div class="sent-nums">${['positive', 'neutral', 'negative'].map(k => `<div><i style="background:${dashSentiment[k]}"></i><strong>${num(s[k])}</strong><span>${sentimentNames[k]}s</span><small>${total ? Math.round(num(s[k]) / total * 100) : 0}%</small></div>`).join('')}</div>`;
}
function topicsPanel(r) {
  const topics = (r.topics || []).slice(0, 5);
  const max = Math.max(...topics.map(t => num(t.count)), 1);
  return panel('Assuntos que mais aparecem', 'Temas identificados nas análises', topics.length ? topics.map(t => `<div class="topic-row"><div><span>${esc(t.subject)}</span><small>${num(t.count)} feedbacks</small></div><div class="topic-track"><span style="width:${num(t.count) / max * 100}%"></span></div></div>`).join('') : empty('Ainda sem assuntos para mostrar.'));
}
function indicatorsPage(r) {
  return `${comparisonBlock(r)}${evolutionPanel(r)}${dashGrid(sentimentPanel(r).replace('</section>', `${sentimentNumbers(r)}</section>`), topicsPanel(r), statusPanel(r))}`;
}
function teamSharePanel(r) {
  const teams = r.teams || [];
  const parts = teams.map((t, i) => ({ label: t.name, value: num(t.received), color: dashPalette[i % dashPalette.length] }));
  return panel('Participação no volume', 'Fatia de feedbacks recebidos por equipe', teams.length ? donutChart(parts, parts.reduce((s, p) => s + p.value, 0), 'feedbacks', 'Participação de cada equipe nos feedbacks') : empty('Nenhuma equipe neste período.'), 's5');
}
function teamsPage(r) {
  return `${kpiStrip(r, true)}<div class="dash-12"><section class="card chart-card s7"><h3>Comparação entre equipes</h3><p>Indicadores agregados das equipes, sem dados pessoais</p>${teamsTable(r)}</section>${teamSharePanel(r)}</div>${teamComparisons(r)}`;
}
function reportsPage(r) {
  const criticality = state.filters.type === 'criticality';
  const types = `<div class="report-type">${btn('Relatório básico', 'report-type', !criticality ? 'selected' : '', 'data-type="general"')}${btn('Relatório de criticidade', 'report-type', criticality ? 'selected' : '', 'data-type="criticality"')}</div>`;
  const main = criticality ? `<div class="section-head"><div><h2>Relatório de criticidade</h2><p>Casos que precisam de atenção e acompanhamento.</p></div></div>${criticalReport(r)}` : `<section class="card chart-card"><h3>Prévia do relatório</h3><p>Indicadores agregados das equipes, sem dados pessoais</p>${teamsTable(r)}</section>`;
  return `${kpiStrip(r, true)}${types}<div class="dash-stack">${main}${reportInfo()}</div>`;
}
function periodText() {
  const f = state.filters;
  if (f.from && f.to) return `${date(f.from)} a ${date(f.to)}`;
  if (f.from) return `A partir de ${date(f.from)}`;
  if (f.to) return `Até ${date(f.to)}`;
  return 'Todo o período registrado';
}
function dashFilters() {
  const v = state.filters;
  const attendants = [...new Map(state.data.tickets.map(t => [t.attendant_id, { id: t.attendant_id, name: t.attendant_name }])).values()];
  const open = v.client_id || v.attendant_id || v.mode || v.q;
  return `<form id="filters-form" class="dash-filters" aria-label="Filtros do painel"><div class="dash-fields">${input('from', 'De', 'date', v.from || '')}${input('to', 'Até', 'date', v.to || '')}${select('team_id', 'Equipe', [['', 'Todas'], ...state.data.teams.map(t => [t.id, t.name])], v.team_id)}${select('channel', 'Canal', [['', 'Todos'], ...['Portal', 'Telefone', 'E-mail', 'Chat']], v.channel)}${select('sentiment', 'Sentimento', [['', 'Todos'], ...Object.entries(sentimentNames).filter(([k]) => k !== 'pending')], v.sentiment)}${select('criticality', 'Criticidade', [['', 'Todas'], ['critical', 'Crítico'], ['regular', 'Regular']], v.criticality)}</div><div class="dash-actions"><button class="btn btn-primary" type="submit">Aplicar</button><a class="btn dash-export" href="/api/reports/export?${esc(new URLSearchParams(state.filters))}" download>Exportar CSV ${icon('dabc1', 15)}</a></div><details class="dash-more"${open ? ' open' : ''}><summary>Mais filtros</summary><div class="dash-more-fields">${select('client_id', 'Cliente', [['', 'Todos'], ...filterClients().map(t => [t.id, t.name])], v.client_id)}${select('attendant_id', 'Atendente', [['', 'Todos'], ...attendants.map(t => [t.id, t.name])], v.attendant_id)}${select('mode', 'Origem', [['', 'Todas'], ['text', 'Texto'], ['audio', 'Áudio gravado'], ['quick', 'Avaliação rápida']], v.mode)}<div class="field"><label for="q">Assunto</label><input id="q" name="q" placeholder="Buscar" value="${esc(v.q || '')}"></div><button class="btn btn-ghost" type="button" data-action="clear-filters">Limpar filtros</button></div></details></form>`;
}
function managerPage(r) {
  const meta = {
    'visao-geral': ['A experiência em perspectiva', 'Indicadores calculados a partir dos registros do banco.', overviewPage],
    indicadores: ['O que os feedbacks nos mostram', 'Como os sentimentos evoluem dia a dia na organização.', indicatorsPage],
    equipes: ['Cada equipe, uma contribuição', 'Compare os resultados das equipes sem expor dados pessoais.', teamsPage],
    relatorios: ['Exporte o que você precisa', 'O CSV respeita os filtros e o seu escopo de acesso.', reportsPage]
  }[state.route];
  const [title, subtitle, build] = meta;
  const band = `<div class="dash-band"><div class="dash-title"><span class="dash-kicker">${esc(periodText())}</span><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${dashFilters()}</div>`;
  return `${band}<div id="report-results">${build(r)}</div><p class="report-note dash-note">${state.route === 'relatorios' ? 'O CSV respeita os filtros e o seu escopo de acesso. Encerrados sem retorno não contam como resolvidos.' : 'A IA apoia a avaliação humana. Os detalhes distinguem resultados do modelo, avaliações por nota e exemplos de demonstração.'}</p>`;
}
function ticketProtocol(ticketId, fallback) { return state.data.tickets.find(t => Number(t.id) === Number(ticketId))?.protocol || fallback; }
function interventionCases() {
  const cases = new Map();
  const add = (ticketId, base, reason) => {
    const item = cases.get(Number(ticketId)) || { ...base, reasons: [] };
    if (reason !== 'Não resolvido' && base.feedbackId) item.feedbackId = base.feedbackId;
    if (!item.reasons.includes(reason)) item.reasons.push(reason);
    cases.set(Number(ticketId), item);
  };
  state.data.feedbacks.forEach(f => {
    const base = { protocol: ticketProtocol(f.ticket_id, f.protocol), client: f.client_name, attendant: f.attendant_name, feedbackId: f.id, ticketId: f.ticket_id };
    if (f.criticality === 'critical' && !f.reviewed) add(f.ticket_id, base, 'Crítico sem revisão');
    if (f.analysis_status === 'failed') add(f.ticket_id, base, 'Análise com falha');
  });
  state.data.tickets.filter(t => t.status === 'active' && t.rejected_at).forEach(t => {
    const last = [...state.data.feedbacks].reverse().find(f => Number(f.ticket_id) === Number(t.id));
    add(t.id, { protocol: t.protocol, client: t.client_name, attendant: t.attendant_name, feedbackId: last?.id, ticketId: t.id }, 'Não resolvido');
  });
  return [...cases.values()];
}
function supervisorDashboard(r) {
  const items = interventionCases();
  const count = reason => items.filter(item => item.reasons.includes(reason)).length;
  const cards = `<div class="stats stats-three">${stat('Críticos sem revisão', count('Crítico sem revisão'), 'Feedbacks críticos que ainda esperam revisão humana', 'red', 'ddda8')}${stat('Análises com falha', count('Análise com falha'), 'Relatos que a IA local não conseguiu analisar', '', '20913')}${stat('Cliente não resolveu', count('Não resolvido'), 'Aguardam uma nova tentativa autorizada por você', '', '04eb3')}</div>`;
  const cols = [{ h: 'Protocolo', cls: 'col-main' }, { h: 'Cliente', cls: 'col-secondary' }, { h: 'Motivo' }, { h: 'Ação', cls: 'action-col' }];
  const rows = items.map(item => {
    const ticket = state.data.tickets.find(t => Number(t.id) === Number(item.ticketId));
    return { cls: item.reasons.includes('Crítico sem revisão') ? 'negative-row' : '', cells: [`<strong>${esc(item.protocol)}</strong>${ticketTags(ticket)}`, `${esc(item.client)}<small>Atendente: ${esc(item.attendant)}</small>`, item.reasons.map(reason => `<span class="badge ${reason === 'Crítico sem revisão' ? 'critical' : reason === 'Não resolvido' ? 'awaiting_feedback' : 'pending'}">${esc(reason)}</span>`).join(' '), item.feedbackId ? `<button class="text-link" data-action="feedback-detail" data-id="${num(item.feedbackId)}">Revisar feedback →</button>` : `<button class="text-link" data-action="ticket-detail" data-id="${num(item.ticketId)}">Ver atendimento →</button>`] };
  });
  const table = `<div class="section-head"><div><h2>Casos para tratar</h2><p>${items.length} ${items.length === 1 ? 'caso precisa' : 'casos precisam'} da supervisão agora</p></div></div><div class="card table-wrap">${items.length ? dtable(cols, rows, 'table-priority') : empty('Nada para tratar agora.', 'Não há críticos sem revisão, análises com falha nem casos não resolvidos na sua equipe.')}</div>`;
  return `${cards}<div id="report-results">${table}<div class="stack gap-sm" style="margin-top:20px">${acc('Evolução da equipe', 'Sentimentos dos feedbacks da sua equipe ao longo do período', trendPanel(r))}${acc('Prazos, prioridades e níveis de suporte', 'Como a equipe cumpre os prazos e onde os casos se concentram', dashGrid(deadlinePanel(r), priorityPanel(r), levelPanel(r)))}</div></div>`;
}
function teamComparisons(r) {
  return `<div class="chart-grid equal">${[['Sentimentos positivos', 'Percentual de positivos entre os feedbacks analisados', 'positive', 'analyzed', 'tone-green'], ['Casos críticos resolvidos', 'Percentual de feedbacks críticos com atendimento resolvido', 'critical_resolved', 'critical', 'tone-blue']].map(([title, subtitle, part, total, tone]) => `<section class="card chart-card ${tone}"><h3>${title}</h3><p>${subtitle}</p>${r.teams?.length ? r.teams.map(team => { const percent = num(team[total]) ? Math.round(num(team[part]) / num(team[total]) * 100) : 0; return `<div class="topic-row"><div><span>${esc(team.name)}</span><small>${percent}% (${num(team[part])} de ${num(team[total])})</small></div><div class="topic-track"><span style="width:${percent}%"></span></div></div>`; }).join('') : empty('Nenhuma equipe neste período.')}</section>`).join('')}</div>`;
}
function reportInfo() {
  return acc('O que vai no arquivo CSV', 'Atendimentos no seu escopo, respeitando os filtros atuais', `<div class="export-fields"><span>Protocolo e assunto do atendimento</span><span>Equipe e canal de atendimento</span><span>Status e data de abertura</span><span>Motivo do encerramento</span></div><div class="banner compact"><p>O CSV contém atendimentos individuais. Gravações, transcrições, evidências e texto dos feedbacks não são exportados.</p></div>`);
}
function reportPage() {
  const r = state.report;
  if (state.user.role === 'manager') return managerPage(r);
  const supervisor = state.user.role === 'supervisor';
  const title = supervisor ? 'Fila de intervenção da equipe' : 'Seus atendimentos em perspectiva';
  const subtitle = supervisor ? 'O que precisa de uma ação da supervisão agora, antes dos gráficos.' : 'Indicadores dos atendimentos que você registrou e dos feedbacks que eles receberam.';
  const heading = `<div class="section-head"><div><h2>${title}</h2><p>${subtitle}</p></div><a href="/api/reports/export?${esc(new URLSearchParams(state.filters))}" class="btn" download>Exportar atendimentos filtrados ${icon('dabc1', 15)}</a></div>`;
  if (supervisor) return `${heading}${supervisorDashboard(r)}<p class="report-note" style="margin-top:20px">A IA apoia a avaliação humana. Os detalhes distinguem resultados do modelo, avaliações por nota e exemplos de demonstração.</p>`;
  const periodNote = '<p class="report-note period-note">Período: os atendimentos são contados pela data de abertura e os feedbacks pela data de recebimento. Por isso os totais podem diferir dentro do mesmo período.</p>';
  const overdue = `<div class="section-head"><div><h2>Prazos que precisam de atenção</h2><p>Lembretes para responder ao cliente.</p></div></div><div class="card table-wrap">${r.response_overdue?.length ? dtable([{ h: 'Atendimento', cls: 'col-main' }, { h: 'Assunto', cls: 'col-secondary' }, { h: 'Prazo' }, { h: 'Ação', cls: 'action-col' }], r.response_overdue.map(t => [`<strong>${esc(t.protocol)}</strong>${ticketTags(t)}`, clip(t.subject), `<span class="negative-text">${date(t.response_due_at, true)}</span>`, link('Responder →', `registrar?id=${t.id}`, 'text-link')]), 'table-priority') : empty('Nenhum prazo de resposta em atraso.', 'Quando um prazo vencer, o atendimento aparece aqui com a ação de responder.')}</div>`;
  const results = `${dashGrid(deadlinePanel(r), priorityPanel(r), levelPanel(r))}${trendPanel(r)}<div class="stack gap-sm" style="margin-top:20px">${acc('Assuntos e resolução', 'Temas dos feedbacks e andamento dos atendimentos', topicsAndCare(r))}</div>${overdue}<div style="margin-top:20px">${reportInfo()}</div>`;
  return `${heading}${periodNote}${filtersForm()}${statistics(r)}<div id="report-results">${results}</div><p class="report-note" style="margin-top:20px">A IA apoia a avaliação humana. Os detalhes distinguem resultados do modelo, avaliações por nota e exemplos de demonstração.</p>`;
}
function criticalReport(r) {
  const items = r.critical_cases || [];
  const cols = [{ h: 'Atendimento', cls: 'col-main' }, { h: 'Sentimento' }, { h: 'Criticidade' }, { h: 'Revisão' }];
  return `<div class="card table-wrap">${items.length ? dtable(cols, items.map(t => ({ cls: 'negative-row', cells: [`<strong>${esc(t.ticket_protocol || t.protocol)}</strong>${clip(t.subject)}`, badge(t.sentiment, sentimentNames), badge(t.criticality || 'critical', criticalityNames), t.reviewed ? 'Revisado' : 'Aguardando avaliação'] }))) : empty('Nenhum caso crítico neste período.')}</div>`;
}
function openDialog(content) { if (!dialog.open) restoreFocus = document.activeElement; dialog.innerHTML = `<div class="dialog-body">${content}</div>`; if (!dialog.open) dialog.showModal(); dialog.querySelector('button,input,select,textarea')?.focus(); }
function closeDialog() { dialog.close(); state.modalFeedbackId = null; restoreFocus?.focus(); }
async function openFeedback(id) {
  const f = state.data.feedbacks.find(f => Number(f.id) === Number(id));
  if (!f) return toast('Feedback não encontrado.', true);
  state.modalFeedbackId = f.id;
  const supervisor = state.user.role === 'supervisor';
  const client = state.user.role === 'client';
  const ticket = state.data.tickets.find(t => Number(t.id) === Number(f.ticket_id));
  openDialog(`<div class="dialog-title-row"><div><div class="eyebrow">${esc(f.protocol)}</div><h2 id="dialog-title">${esc(f.subject)}</h2></div><button type="button" class="dialog-close" data-action="modal-close" aria-label="Fechar detalhes">×</button></div><p class="dialog-sub">${date(f.created_at, true)} · ${esc(modeNames[f.mode])}${!client ? ` · ${esc(f.client_name)} · Atendente: ${esc(f.attendant_name)}` : ''}</p><div id="feedback-transcript">${transcriptContent(f)}</div>${f.mode === 'audio' && !f.redacted_at ? `<audio controls preload="none" style="width:100%" src="/api/feedbacks/${num(f.id)}/audio">Seu navegador não oferece reprodução de áudio.</audio>` : ''}${!client ? `<section class="dialog-section" id="feedback-analysis" aria-live="polite">${analysisContent(f)}</section><section class="dialog-section"><h3>Revisão humana atual</h3>${f.reviewed ? `<div class="button-row">${badge(f.sentiment, sentimentNames)}${badge(f.criticality, criticalityNames)}</div>` : '<p class="small">Ainda não há revisão humana registrada.</p>'}</section><section class="dialog-section"><h3>Como casos semelhantes foram resolvidos</h3><div id="modal-cases"><p class="small">Consultando a base de resoluções...</p></div></section><section class="dialog-section"><h3>Histórico de revisões</h3>${f.reviews?.length ? f.reviews.map(review => `<article class="review-entry"><strong>${esc(review.reviewer_name || review.name || 'Supervisor')} · ${esc(sentimentNames[review.sentiment] || review.sentiment)} · ${esc(criticalityNames[review.criticality] || review.criticality)}</strong><small>${date(review.created_at, true)}</small><p>Justificativa: ${esc(review.justification)}<br>Providência: ${esc(review.action)}</p></article>`).join('') : '<p class="small">Ainda não há revisão humana registrada.</p>'}</section>${supervisor ? `<section class="dialog-section"><h3>Revisão humana</h3><form id="review-form" class="review-form" data-id="${f.id}"><div class="form-grid">${select('review_sentiment', 'Sentimento', Object.entries(sentimentNames).filter(([key]) => key !== 'pending'), f.sentiment)}${select('review_criticality', 'Criticidade', Object.entries(criticalityNames), f.criticality)}${textarea('justification', 'Justificativa da revisão', '', 'required minlength="10" maxlength="1000" rows="2"')}${textarea('action', 'Providência para resolver o problema', '', 'required minlength="10" maxlength="1000" rows="2"')}</div><div class="form-actions"><small>A revisão fica registrada no histórico.</small><button class="btn btn-primary" type="submit">Salvar revisão</button></div></form></section>${ticket?.status === 'active' && ticket.rejected_at ? retryForm(ticket) : ''}` : ''}` : `<div id="client-analysis-status" aria-live="polite">${analysisStatus(f)}</div><div class="banner compact ${f.resolved ? 'banner-success' : 'banner-warning'}"><p>${f.resolved ? 'Sua confirmação foi registrada. Obrigado por compartilhar.' : 'Você informou que o problema continua. A equipe seguirá com o acompanhamento.'}</p></div>`}<div class="modal-footer">${btn('Fechar', 'modal-close')}</div>`);
  if (!client) { try { const results = await api(`/tickets/${f.ticket_id}/cases`); const target = dialog.querySelector('#modal-cases'); if (target && state.modalFeedbackId === f.id) target.innerHTML = caseCards(Array.isArray(results) ? results : results.cases || []); } catch (error) { const target = dialog.querySelector('#modal-cases'); if (target) target.innerHTML = `<p class="small">${esc(error.message)}</p>`; } }
}
function retryForm(ticket) { return `<section class="dialog-section"><div class="banner banner-warning compact"><p>O cliente informou que a solução não funcionou. Apenas o supervisor pode autorizar uma nova tentativa, sem nova alteração manual pelo atendente.</p></div><form id="retry-form" data-id="${ticket.id}"><div class="form-grid">${textarea('retry_solution', 'Nova solução proposta', '', 'required minlength="10" maxlength="2000" rows="3"')}${textarea('retry_justification', 'Justificativa para a nova tentativa', '', 'required minlength="10" maxlength="1000" rows="2"')}</div><div class="form-actions"><small>O cliente receberá uma nova solicitação de confirmação, com prazo de 3 dias.</small><button type="submit" class="btn btn-primary">Autorizar nova tentativa</button></div></form></section>`; }
function escalateForm(t) {
  const levels = [2, 3].filter(level => level > num(t.support_level));
  if (state.user.role !== 'supervisor' || !levels.length || !['active', 'awaiting_feedback'].includes(t.status)) return '';
  return `<section class="dialog-section"><h3>Escalar atendimento</h3><form id="escalate-form" class="escalate-row" data-id="${t.id}"><div class="field"><label for="escalate_level">Escalar para o nível</label><select id="escalate_level" name="level">${levels.map(level => `<option value="${level}">N${level}</option>`).join('')}</select></div><button type="submit" class="btn btn-primary">Escalar</button></form></section>`;
}
async function openTicket(id) {
  const t = state.data.tickets.find(t => Number(t.id) === Number(id));
  if (!t) return;
  const client = state.user.role === 'client';
  const place = clientPlace(t);
  openDialog(`<div class="dialog-title-row"><div><div class="eyebrow">${esc(t.protocol)}</div><h2 id="dialog-title">${esc(t.subject)}</h2></div><button class="dialog-close" data-action="modal-close" aria-label="Fechar atendimento">×</button></div><p class="dialog-sub">${esc(t.client_name)} · ${esc(t.attendant_name)} · ${esc(t.channel)}</p><div class="button-row" style="margin-top:18px">${badge(t.status)}${levelBadge(t.support_level)}${priorityBadge(t.priority)}</div><dl class="description-list"><dt>Localização</dt><dd>${place ? esc(place) : 'Não informada'}</dd><dt>Registro</dt><dd>${date(t.created_at, true)}</dd>${state.user.role === 'attendant' ? `<dt>Responder até</dt><dd>${date(t.response_due_at, true)}</dd>` : ''}<dt>Confirmação até</dt><dd>${t.feedback_deadline ? date(t.feedback_deadline, true) : 'Ainda sem solução enviada'}</dd></dl>${t.solution ? `<section class="dialog-section"><h3>Solução enviada pela equipe</h3><div class="feedback-quote">${esc(t.solution)}</div></section>` : ''}${repliesBlock(t)}${!client ? '<section class="dialog-section"><h3>Cases de resolução relacionados</h3><div id="ticket-cases">Consultando a base...</div></section>' : ''}${escalateForm(t)}${state.user.role === 'supervisor' && t.status === 'active' && t.rejected_at ? retryForm(t) : ''}<div class="modal-footer">${btn('Fechar', 'modal-close')}</div>`);
  if (client) return;
  try { const cases = await api(`/tickets/${id}/cases`); const target = dialog.querySelector('#ticket-cases'); if (target) target.innerHTML = caseCards(Array.isArray(cases) ? cases : cases.cases || []); }
  catch (error) { const target = dialog.querySelector('#ticket-cases'); if (target) target.innerHTML = `<p class="small">${esc(error.message)}</p>`; }
}
function notificationsDialog() { const list = state.data.notifications || []; openDialog(`<div class="dialog-title-row"><div><div class="eyebrow">Sua rotina, com mais cuidado</div><h2 id="dialog-title">Alertas e lembretes</h2></div><button class="dialog-close" data-action="modal-close" aria-label="Fechar alertas">×</button></div><p class="dialog-sub">Lembretes aparecem na plataforma. Nenhuma mensagem externa é enviada.</p><div class="notification-list" style="margin-top:20px">${list.length ? list.map(n => `<article class="notification-item ${n.due_at && new Date(n.due_at) < new Date() ? 'overdue' : ''}"><h3>${esc(n.title)}</h3><p>${esc(n.message)}</p>${n.due_at ? `<small>${date(n.due_at, true)}</small>` : ''}${n.ticket_id && state.user.role === 'attendant' ? `<div style="margin-top:8px"><a href="#registrar?id=${num(n.ticket_id)}" class="text-link" data-action="notification-open">Ver atendimento →</a></div>` : ''}${state.user.role === 'client' ? `<div style="margin-top:8px"><a href="#enviar-feedback" class="text-link" data-action="notification-open">Ir para Enviar feedback →</a></div>` : ''}</article>`).join('') : '<p class="notification-empty">Tudo em dia. Não há novos alertas para você.</p>'}</div>`); }
function clearAudio() { if (state.audio?.url) URL.revokeObjectURL(state.audio.url); state.audio = null; }
function updateModeLock() { const text = document.querySelector('#feedback-text')?.value || ''; document.querySelectorAll('[data-action="feedback-mode"]').forEach(button => { button.disabled = (state.formMode !== button.dataset.mode) && Boolean(text || state.audio || state.recording); }); }
function clearFeedback() { stopRecording(true); clearAudio(); const input = document.querySelector('#feedback-text'); if (input) input.value = ''; changeMode('text'); }
function changeMode(mode) { if (!['text', 'audio'].includes(mode) || state.recording || state.audio || document.querySelector('#feedback-text')?.value) return; state.formMode = mode; document.querySelectorAll('[data-action="feedback-mode"]').forEach(b => { b.classList.toggle('selected', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); b.querySelector('img').src = `/assets/figma/${b.dataset.mode === 'text' ? (mode === 'text' ? '0b772' : '83a8f') : (mode === 'audio' ? '01f51' : 'c1f96')}.svg`; }); document.querySelector('#feedback-content').innerHTML = mode === 'text' ? textFeedbackContent() : audioFeedbackContent(); updateModeLock(); }
function waveBlob(samples, sampleRate) {
  const length = samples.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2); const view = new DataView(buffer);
  function write(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 2, true);
  let offset = 44; for (const chunk of samples) for (const s of chunk) { const value = Math.max(-1, Math.min(1, s)); view.setInt16(offset, value < 0 ? value * 32768 : value * 32767, true); offset += 2; }
  return new Blob([view], { type: 'audio/wav' });
}
async function startRecording() {
  if (state.recording || state.audio) return;
  if (!navigator.mediaDevices?.getUserMedia) return toast('Seu navegador não permite gravar áudio neste endereço. Use localhost ou HTTPS e permita o microfone.', true);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    if (!document.querySelector('#recording-panel')) { stream.getTracks().forEach(t => t.stop()); return; }
    const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 }); await context.resume();
    const source = context.createMediaStreamSource(stream); const processor = context.createScriptProcessor(4096, 1, 1); const silent = context.createGain(); silent.gain.value = 0;
    recordingSession = { stream, context, source, processor, silent, samples: [], count: 0, rate: context.sampleRate, started: Date.now(), timer: null };
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    processor.onaudioprocess = event => { const session = recordingSession; if (!session) return; const data = event.inputBuffer.getChannelData(0); const remaining = session.rate * 60 - session.count; if (remaining > 0) { const chunk = new Float32Array(data.slice(0, remaining)); session.samples.push(chunk); session.count += chunk.length; } if (session.count >= session.rate * 60) stopRecording(); };
    state.recording = true;
    document.querySelector('#record-start').hidden = true; document.querySelector('#record-stop').hidden = false;
    document.querySelector('#recording-panel').classList.add('live'); document.querySelector('#recording-time').classList.add('live');
    recordingSession.timer = setInterval(() => { const session = recordingSession; if (!session) return; const elapsed = Math.min(60, Math.floor((Date.now() - session.started) / 1000)); const el = document.querySelector('#recording-time'); if (el) el.textContent = `Gravando... 00:${String(elapsed).padStart(2, '0')} de 01:00`; if (elapsed >= 60) stopRecording(); }, 250);
    updateModeLock();
  } catch (error) { stream?.getTracks().forEach(t => t.stop()); stopRecording(true); toast(error.name === 'NotAllowedError' ? 'O microfone não foi autorizado. Você pode permitir o acesso no navegador ou escrever seu feedback.' : 'Não foi possível iniciar o microfone. Confira o dispositivo e tente novamente.', true); }
}
function stopRecording(discard = false) {
  const session = recordingSession; if (!session) return;
  recordingSession = null; state.recording = false; clearInterval(session.timer); session.processor.onaudioprocess = null; session.processor.disconnect(); session.source.disconnect(); session.silent.disconnect(); session.stream.getTracks().forEach(t => t.stop()); session.context.close().catch(() => {});
  if (!discard && session.count > 0) { const blob = waveBlob(session.samples, session.rate); if (blob.size > 6 * 1024 * 1024) return toast('A gravação ultrapassou o limite. Grave um trecho menor.', true); clearAudio(); state.audio = { blob, url: URL.createObjectURL(blob), duration: session.count / session.rate }; }
  const panel = document.querySelector('#recording-panel'); if (panel) { panel.classList.remove('live'); document.querySelector('#recording-time').classList.remove('live'); document.querySelector('#recording-time').textContent = state.audio ? `Gravação pronta · ${Math.ceil(state.audio.duration)} segundos` : 'Sua voz também importa.'; document.querySelector('#record-start').hidden = Boolean(state.audio); document.querySelector('#record-stop').hidden = true; document.querySelector('#audio-preview').innerHTML = state.audio ? `<audio controls src="${state.audio.url}" aria-label="Ouvir sua gravação"></audio><p class="small">Ouça antes de confirmar o envio.</p>` : ''; }
  updateModeLock();
}
async function submitForm(form) {
  if (!form.reportValidity()) return;
  const controls = [...form.querySelectorAll('button[type="submit"],button[data-submit]')]; controls.forEach(b => b.disabled = true);
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'login-form') { const session = await api('/session'); state.csrf = session.csrf_token; const result = await api('/login', { method: 'POST', body: data }); state.user = result.user || result; state.csrf = result.csrf_token || state.csrf; state.data = null; state.filters = {}; location.hash = routes[state.user.role][0][0]; await render(); return; }
    if (form.id === 'ticket-form') { const payload = { subject: data.subject, channel: data.channel }; if (!form.dataset.id) { payload.priority = data.priority; payload.client_id = num(data.client_id); payload.status = data.status === 'resolved' ? 'resolved' : 'active'; if (payload.status === 'resolved') payload.solution = (data.solution || '').trim(); } if (state.selectedCategory) payload.category_id = state.selectedCategory; const result = await api(form.dataset.id ? `/tickets/${form.dataset.id}` : '/tickets', { method: form.dataset.id ? 'PATCH' : 'POST', body: payload }); await refreshData(); toast(form.dataset.id ? 'Informações do atendimento atualizadas.' : payload.status === 'resolved' ? `Atendimento registrado como resolvido. A solução foi enviada ao cliente para confirmação. Protocolo: ${result.protocol || result.ticket?.protocol || 'disponível na lista'}` : `Atendimento registrado. Protocolo: ${result.protocol || result.ticket?.protocol || 'disponível na lista'}`); if (!form.dataset.id && result.id) location.hash = `registrar?id=${result.id}`; else await render(); return; }
    if (form.id === 'escalate-form') { const id = num(form.dataset.id); await api(`/tickets/${id}/escalate`, { method: 'POST', body: { level: num(data.level) } }); await refreshData(); toast(`Atendimento escalado para o nível N${num(data.level)}.`); await render(); await openTicket(id); return; }
    if (form.id === 'solution-form') { await api(`/tickets/${form.dataset.id}/solution`, { method: 'POST', body: { solution: data.solution } }); await refreshData(); toast('Solução enviada. Agora o sistema aguarda a confirmação do cliente.'); await render(); return; }
    if (form.id === 'reply-form') { await api(`/tickets/${form.dataset.id}/reply`, { method: 'POST', body: { message: data.message } }); await refreshData(); toast('Resposta registrada e disponível ao cliente.'); await render(); return; }
    if (form.id === 'filters-form') { if (data.from && data.to && data.from > data.to) throw new Error('A data inicial precisa ser anterior ou igual à data final.'); state.filters = { ...Object.fromEntries(Object.entries(data).filter(([, v]) => v)), ...(state.filters.type ? { type: state.filters.type } : {}) }; if (['feedbacks', 'criticos'].includes(state.route)) shell(state.route === 'criticos' ? criticalPage() : feedbacksPage()); else { state.report = await api(`/reports?${new URLSearchParams(state.filters)}`); showReport(); } toast('Filtros aplicados.'); return; }
    if (form.id === 'review-form') { const id = num(form.dataset.id); await api(`/feedbacks/${id}/review`, { method: 'POST', body: { sentiment: data.review_sentiment, criticality: data.review_criticality, justification: data.justification, action: data.action } }); await refreshData(); toast('Revisão salva no histórico.'); await openFeedback(id); return; }
    if (form.id === 'retry-form') { await api(`/tickets/${form.dataset.id}/retry`, { method: 'POST', body: { solution: data.retry_solution, justification: data.retry_justification } }); await refreshData(); closeDialog(); toast('Nova tentativa autorizada. O cliente já pode confirmar a nova solução.'); await render(); return; }
    if (form.id === 'feedback-form') {
      const ticketId = num(data.ticket_id); const resolved = data.resolved === '1';
      let payload;
      if (state.recording) throw new Error('Pare a gravação e ouça seu feedback antes de enviar.');
      if (state.formMode === 'audio') { if (!state.audio) throw new Error('Grave seu feedback ou use Descartar áudio e trocar formato para enviar só a nota.'); payload = new FormData(); payload.append('ticket_id', ticketId); payload.append('rating', data.rating); payload.append('resolved', resolved ? '1' : '0'); payload.append('mode', 'audio'); payload.append('audio', state.audio.blob, 'feedback.wav'); }
      else { const text = (data.text || '').trim(); if (text.length > 500 || text.split(/\r?\n/).length > 5) throw new Error('Escreva um feedback com até 500 caracteres e 5 linhas.'); payload = { ticket_id: ticketId, rating: num(data.rating), resolved, mode: text ? 'text' : 'quick', ...(text ? { text } : {}) }; }
      const received = await api('/feedbacks', { method: 'POST', body: payload }); clearAudio(); await refreshData(); state.decision = null; document.querySelector('#page-content').innerHTML = `<section class="card success-card"><div class="success-check">✓</div><div class="eyebrow">Feedback recebido</div><h2>Obrigado por compartilhar sua experiência.</h2><p>${resolved ? 'Feedback recebido. Sua confirmação foi registrada e o atendimento será encerrado.' : 'Feedback recebido. A equipe foi informada de que você ainda precisa de ajuda e seguirá acompanhando o problema com você.'}</p><div class="receipt-protocol"><small>Protocolo</small><strong>${esc(received.protocol || 'Disponível em meus feedbacks')}</strong></div><div class="button-row" style="justify-content:center">${link('Ver meus feedbacks', 'feedbacks')}${btn('Voltar ao início', 'client-home')}</div></section>`; return;
    }
  } catch (error) { formError(form, error); }
  finally { controls.forEach(b => b.disabled = false); }
}
document.addEventListener('submit', event => { if (event.target.matches('form')) { event.preventDefault(); submitForm(event.target); } });
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
  const action = target.dataset.action;
  try {
    if (action === 'demo-login') { document.querySelector('#login-email').value = target.dataset.email; document.querySelector('#login-password').value = 'CtiDemo2026!'; document.querySelector('#login-email').focus(); }
    else if (action === 'logout') { stopRecording(true); await api('/logout', { method: 'POST' }); state.user = null; state.data = null; state.filters = {}; location.hash = ''; const session = await api('/session'); state.csrf = session.csrf_token; renderLogin(); }
    else if (action === 'theme') { const dark = !dashDark(); try { localStorage.setItem('cti-tema', dark ? 'escuro' : 'claro'); } catch { /* sem armazenamento: vale so ate recarregar */ } themeMemory = dark; document.querySelector('.theme-dash')?.classList.toggle('dark', dark); target.setAttribute('aria-pressed', String(dark)); target.textContent = dark ? 'Tema claro' : 'Tema escuro'; }
    else if (action === 'menu' || action === 'menu-close') { const open = action === 'menu' && !document.querySelector('.sidebar').classList.contains('open'); document.querySelector('.sidebar').classList.toggle('open', open); document.querySelector('.mobile-backdrop').classList.toggle('open', open); document.querySelector('.menu-btn').setAttribute('aria-expanded', String(open)); }
    else if (action === 'notifications') notificationsDialog();
    else if (action === 'modal-close' || action === 'notification-open') closeDialog();
    else if (action === 'refresh') { state.data = null; await init(); }
    else if (action === 'decide') { stopRecording(true); clearAudio(); state.formMode = 'text'; state.decision = { ticket: num(target.dataset.id), resolved: target.dataset.resolved === '1' ? '1' : '0' }; document.querySelector('#page-content').innerHTML = feedbackFormPage(); document.querySelector(`.ticket-card[data-ticket="${state.decision.ticket}"] input[name="rating"]`)?.focus(); }
    else if (action === 'decision-clear' || action === 'client-home') { stopRecording(true); clearAudio(); state.formMode = 'text'; state.decision = null; if (action === 'client-home') await render(); else document.querySelector('#page-content').innerHTML = feedbackFormPage(); }
    else if (action === 'feedback-detail') await openFeedback(target.dataset.id);
    else if (action === 'ticket-detail') await openTicket(target.dataset.id);
    else if (action === 'retry-analysis') { target.disabled = true; try { await api(`/feedbacks/${num(target.dataset.id)}/retry-analysis`, { method: 'POST' }); await refreshData(); updateAnalysisViews(); toast('Análise adicionada novamente à fila.'); } finally { target.disabled = false; } }
    else if (action === 'apply-case') { const c = state.caseResults.find(c => Number(c.id) === Number(target.dataset.id)); if (c) { document.querySelector('#subject').value = c.subject; state.selectedCategory = c.category_id; document.querySelector('#subject-suggestions').hidden = true; document.querySelector('#subject').setAttribute('aria-expanded', 'false'); const solution = document.querySelector('#solution'); if (solution && !solution.value) solution.value = c.solution; toast('Assunto preenchido a partir do case de resolução.'); } }
    else if (action === 'feedback-mode') changeMode(target.dataset.mode);
    else if (action === 'clear-feedback') clearFeedback();
    else if (action === 'record-start') await startRecording();
    else if (action === 'record-stop') stopRecording();
    else if (action === 'evo-mode') setEvoMode(target);
    else if (action === 'clear-filters') { state.filters = {}; await render(); }
    else if (action === 'report-type') { state.filters.type = target.dataset.type; state.report = await api(`/reports?${new URLSearchParams(state.filters)}`); showReport(); }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'subject') { state.selectedCategory = null; clearTimeout(caseTimer); const q = event.target.value; caseTimer = setTimeout(() => loadRelatedCases(q), 240); }
  if (event.target.id === 'client-search') { const list = document.querySelector('#clients-list'); if (list) list.innerHTML = clientsTable(event.target.value); }
  if (event.target.id === 'feedback-text') { const lines = event.target.value.split(/\r?\n/); if (lines.length > 5) event.target.value = lines.slice(0, 5).join('\n'); document.querySelector('#feedback-counter').textContent = `${event.target.value.length} de 500 caracteres · até 5 linhas`; updateModeLock(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'priority') { const hint = document.querySelector('#priority-hint'); if (hint && !event.target.disabled) hint.textContent = priorityHint(event.target.value); return; }
  if (event.target.id !== 'status') return;
  const box = document.querySelector('#create-solution'); const field = box?.querySelector('#solution');
  if (!box || !field) return;
  const resolved = event.target.value === 'resolved';
  box.hidden = !resolved; field.disabled = !resolved;
});
document.addEventListener('keydown', event => { if (event.target.id === 'subject') { const list = document.querySelector('#subject-suggestions'); if (event.key === 'Escape') { list.hidden = true; event.target.setAttribute('aria-expanded', 'false'); } if (event.key === 'ArrowDown' && !list.hidden) { event.preventDefault(); list.querySelector('button')?.focus(); } } });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });
dialog.addEventListener('cancel', () => { state.modalFeedbackId = null; });
window.addEventListener('hashchange', () => { if (dialog.open) closeDialog(); state.decision = null; state.filters = {}; render(); });
window.addEventListener('pagehide', () => { stopRecording(true); clearAudio(); });
async function init() { try { const session = await api('/session'); state.user = session.user; state.csrf = session.csrf_token; await render(); } catch (error) { app.innerHTML = `<main id="main" class="initial-loading"><div><h2>Não foi possível abrir a plataforma.</h2><p>${esc(error.message)}</p>${btn('Tentar novamente', 'refresh')}</div></main>`; } }
function notificationKey(notification) { return JSON.stringify([notification.type, notification.ticket_id, notification.feedback_id, notification.due_at]); }
function updateNotificationCounter(notifications) {
  const button = document.querySelector('[data-action="notifications"]');
  if (!button) return;
  button.setAttribute('aria-label', `Alertas e lembretes${notifications.length ? `: ${notifications.length}` : ''}`);
  let counter = button.querySelector('#notification-count');
  if (!counter) { counter = document.createElement('span'); counter.id = 'notification-count'; counter.className = 'notification-count'; button.append(counter); }
  counter.hidden = notifications.length === 0;
  counter.textContent = String(notifications.length);
}
async function pollNotifications() {
  if (!state.user || !state.data || document.hidden || activeMutations || notificationPollInFlight) return;
  notificationPollInFlight = true;
  const userId = state.user.id;
  const csrf = state.csrf;
  const version = mutationVersion;
  const priorData = state.data;
  const isCurrent = () => state.user?.id === userId && state.csrf === csrf && mutationVersion === version && state.data === priorData && activeMutations === 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/bootstrap', { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!isCurrent()) return;
    if (response.status === 401) {
      stopRecording(true); clearAudio();
      if (dialog.open) closeDialog();
      state.user = null; state.data = null; state.csrf = ''; state.renderId++;
      renderLogin();
      toast('Sua sessão expirou. Entre novamente para continuar.', true);
      return;
    }
    if (!response.ok) return;
    const json = await response.json();
    if (!isCurrent() || json.data?.user?.id !== userId) return;
    const oldKeys = new Set((priorData.notifications || []).map(notificationKey));
    const notifications = json.data.notifications || [];
    const added = notifications.filter(notification => !oldKeys.has(notificationKey(notification)));
    const analysisChanged = JSON.stringify(priorData.feedbacks.map(analysisKey)) !== JSON.stringify(json.data.feedbacks.map(analysisKey));
    state.data = json.data;
    state.user = json.data.user;
    if (analysisChanged) { updateAnalysisViews(); await updateAnalysisReport(); }
    updateNotificationCounter(notifications);
    if (added.length) toast('Há novos lembretes para você. Confira os alertas na barra superior.');
  } catch {
    // A consulta seguinte recupera os lembretes sem descartar o que está sendo digitado.
  } finally { clearTimeout(timeout); notificationPollInFlight = false; }
}
init();
setInterval(pollNotifications, 60000);
setInterval(() => { if (state.data?.feedbacks.some(feedback => ['pending', 'processing'].includes(feedback.analysis_status))) pollNotifications(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNotifications(); });
