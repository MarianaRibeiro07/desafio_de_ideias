const app = document.querySelector('#app');
const dialog = document.querySelector('#detail-dialog');
const state = { user: null, csrf: '', data: null, report: null, route: '', params: new URLSearchParams(), filters: {}, quickId: null, formMode: 'text', audio: null, recording: false, modalFeedbackId: null, caseResults: [], selectedCategory: null, renderId: 0 };
const roleNames = { attendant: 'Atendente', supervisor: 'Supervisor', manager: 'Gestor', client: 'Cliente' };
const statusNames = { active: 'Em atendimento', awaiting_feedback: 'Aguardando cliente', resolved: 'Resolvido', closed_no_response: 'Encerrado sem retorno' };
const sentimentNames = { positive: 'Positivo', neutral: 'Neutro', negative: 'Negativo', pending: 'Pendente' };
const criticalityNames = { critical: 'Crítico', regular: 'Regular' };
const modeNames = { quick: 'Avaliação rápida', text: 'Texto', audio: 'Áudio gravado' };
const routes = {
  attendant: [['atendimentos', 'Meus atendimentos'], ['registrar', 'Registrar atendimento'], ['feedbacks', 'Feedbacks dos meus atendimentos'], ['relatorio', 'Meu relatório']],
  supervisor: [['dashboard', 'Dashboard da equipe'], ['atendimentos', 'Atendimentos da equipe'], ['feedbacks', 'Feedbacks da equipe'], ['criticos', 'Casos críticos']],
  manager: [['visao-geral', 'Visão geral'], ['indicadores', 'Indicadores e tendências'], ['equipes', 'Comparação entre equipes'], ['relatorios', 'Relatórios']],
  client: [['atendimentos', 'Meus atendimentos'], ['enviar-feedback', 'Enviar feedback'], ['feedbacks', 'Meus feedbacks']]
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
  const files = { atendimentos: active ? '74d5d' : '3beb0', registrar: active ? '218d5' : '5bf39', feedbacks: active ? '5dc6e' : '3928a', dashboard: 'fe998', criticos: 'a8049', 'visao-geral': active ? '3b9ea' : 'fe998', indicadores: active ? '2ccfc' : '164c8', equipes: active ? '5b8fb' : '82039', relatorios: active ? '75e27' : '34ec9', 'enviar-feedback': active ? '45599' : '35636' };
  return files[path] ? icon(files[path]) : '';
}
function date(value, time = false) { if (!value) return 'Não informado'; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value); return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString('pt-BR', time ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }); }
function localInput(value) { if (!value) return ''; const d = new Date(value); if (Number.isNaN(d.getTime())) return ''; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
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
function brand() { return `<div class="brand"><div><span class="brand-logo"><img src="/assets/cti-oficial.png" width="416" height="158" alt="CTI, conectando empresas e pessoas"></span><div class="brand-word">escuta</div></div></div>`; }
function renderLogin() {
  app.innerHTML = `<div class="login"><section class="login-hero">${brand()}<div class="login-hero-content"><div class="eyebrow">Conexões que começam com a escuta</div><h1>Cada experiência<br>tem algo <span>a dizer.</span></h1><p>Transforme feedbacks em cuidado. Conecte sua equipe ao que realmente importa.</p><div class="login-art" aria-label="Conectividade, segurança e cloud"><div class="orbit"></div><div class="orbit inner"></div><div class="hero-message">${icon('a9fb2', 52)}</div><div class="hero-tag connect">${icon('a7dc4', 15)}Conectividade</div><div class="hero-tag secure">${icon('77d7c', 15)}Segurança</div><div class="hero-tag cloud">${icon('834ef', 15)}Cloud</div></div></div><div class="login-footer"><span>Projeto integrador · SENAI 2026</span><span>Conexões que importam</span></div></section><section class="login-panel"><main id="main" class="login-panel-center"><div class="login-form"><div class="eyebrow">Bem-vindo à CTI Escuta</div><h2>Bom ter você por aqui.</h2><p>Entre para acessar o seu espaço.</p><form id="login-form" class="login-fields"><div class="field"><label for="login-email">E-mail</label><input id="login-email" name="email" type="email" placeholder="seu.email@empresa.com.br" autocomplete="username" required></div><div class="field"><label for="login-password">Senha</label><input id="login-password" name="password" type="password" placeholder="Sua senha" autocomplete="current-password" required></div><button class="btn btn-primary" type="submit"><span>Entrar na plataforma</span>${icon('f45dc')}</button></form><div class="secure-caption">${icon('3f6e3', 15)}Acesso seguro e exclusivo para a sua conta</div><div class="login-note"><strong>Um só lugar. A escuta certa para cada pessoa.</strong>Seu acesso é definido pela sua conta. Precisa de ajuda? Procure o responsável pela plataforma.</div><details class="demo-accounts"><summary>Acessos de demonstração</summary>${[['rafael', 'Atendente'], ['marina', 'Supervisor'], ['helena', 'Gestor'], ['lucas', 'Cliente']].map(([name, role]) => `<button class="demo-account" data-action="demo-login" data-email="${name}@cti.demo" type="button">${role}: ${name}@cti.demo</button>`).join('')}<p>Senha das contas fictícias: <strong>CtiDemo2026!</strong></p></details></div></main><div class="login-footer"><span>CTI Escuta · Plataforma acadêmica</span><span>Privacidade em primeiro lugar</span></div></section></div>`;
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
  app.innerHTML = `<div class="layout"><button class="mobile-backdrop" data-action="menu-close" aria-label="Fechar menu"></button><aside class="sidebar" id="sidebar"><div class="sidebar-brand">${brand()}</div><div class="space-label">Espaço ${esc(roleNames[state.user.role].toLowerCase())}</div><nav class="nav-list" aria-label="Menu principal">${routes[state.user.role].map(([path, label]) => `<a href="#${path}" class="nav-link ${state.route === path ? 'active' : ''}" ${state.route === path ? 'aria-current="page"' : ''}>${navigationIcon(path)}${esc(label)}${path === 'criticos' && state.data.feedbacks.some(f => f.criticality === 'critical') ? '<span class="nav-mark" aria-label="Há casos críticos"></span>' : ''}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="listen-card"><strong>Vamos ouvir melhor?</strong><p>Feedbacks são o começo de uma boa conexão.</p></div><p class="sidebar-caption">Projeto SENAI · CTI Escuta<br>Cada voz, uma oportunidade.</p><div class="user-panel"><div class="avatar">${initial()}</div><div><div class="user-name">${esc(state.user.name)}</div><div class="user-role">${esc(roleNames[state.user.role])}</div></div><button class="logout-btn" data-action="logout" title="Sair da conta" aria-label="Sair da conta">${icon('fe916')}</button></div></div></aside><div class="work-area"><header class="topbar"><div class="button-row"><button type="button" class="menu-btn" data-action="menu" aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">☰</button><div class="breadcrumb"><span>Plataforma de experiência</span><span>/</span><strong>${esc(roleNames[state.user.role])}</strong></div></div><div class="header-actions"><span class="academic">Ambiente acadêmico</span><button class="notification-btn" data-action="notifications" aria-label="Alertas e lembretes${alerts.length ? `: ${alerts.length}` : ''}" title="Alertas e lembretes">◷${alerts.length ? `<span id="notification-count" class="notification-count">${alerts.length}</span>` : ''}</button><div class="avatar">${initial()}</div></div></header><main id="main" class="main"><div class="page-heading"><div><div class="eyebrow">Ouvir. Entender. Evoluir.</div><h1>${esc(title)}<span class="dot">.</span></h1><p>${esc(subtitle)}</p></div>${['manager', 'supervisor'].includes(state.user.role) ? `<div class="date-pill">${icon('2fbac', 15)}${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>` : ''}</div>${demoBanner()}<div id="page-content">${content}</div><footer class="footer"><span>CTI Escuta · Cada voz, uma oportunidade.</span><span>Conectividade / Segurança / Cloud</span></footer></main></div></div>`;
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
  if (!routes[state.user.role].some(r => r[0] === state.route)) { app.innerHTML = `<main id="main" class="standalone-error"><div><div class="error-brand">${brand()}</div><div class="error-code" aria-hidden="true">404</div><div class="eyebrow">CTI Escuta · Erro 404</div><h1>Não encontramos esta página.</h1><p>Você pode voltar ao seu espaço pela página inicial.</p>${link(`Voltar ao meu espaço ${icon('f45dc')}`, routes[state.user.role][0][0])}</div></main>`; document.title = 'Página não encontrada | CTI Escuta'; return; }
  if (state.route === 'atendimentos') shell(ticketsPage());
  else if (state.route === 'registrar') { shell(registerPage()); loadRelatedCases(); }
  else if (state.route === 'feedbacks') shell(feedbacksPage());
  else if (state.route === 'enviar-feedback') shell(feedbackFormPage());
  else if (state.route === 'criticos') shell(criticalPage());
  else { shell(`<div class="card loading-card"><span class="spinner"></span>Calculando os indicadores do banco...</div>`); try { state.report = await api(`/reports?${new URLSearchParams(state.filters)}`); if (id !== state.renderId) return; document.querySelector('#page-content').innerHTML = reportPage(); } catch (error) { if (id === state.renderId) document.querySelector('#page-content').innerHTML = `<div class="inline-error" role="alert">${esc(error.message)}</div>`; } }
}
function ticketFeedback(ticket) { return state.data.feedbacks.find(f => Number(f.ticket_id) === Number(ticket.id) && (f.attempt === undefined || ticket.solution_attempt === undefined || Number(f.attempt) === Number(ticket.solution_attempt))); }
function canFeedback(ticket) { return ticket.status === 'awaiting_feedback' && !ticketFeedback(ticket); }
function clientTicketActions(ticket) { return `<div class="stack gap-sm">${canFeedback(ticket) ? `<button class="text-link" data-action="quick-feedback" data-id="${ticket.id}">Avaliar em segundos →</button>` : `<span class="small">${ticket.status === 'active' ? 'Em acompanhamento' : ticketFeedback(ticket) ? 'Feedback registrado' : 'Encerrado'}</span>`}<button class="text-link" data-action="ticket-detail" data-id="${ticket.id}">Ver conversa →</button></div>`; }
function repliesBlock(ticket) { const replies = ticket.replies || []; return replies.length ? `<section class="dialog-section"><h3>Respostas da equipe</h3><div class="stack gap-sm">${replies.map(reply => `<article class="ticket-note"><strong>${esc(reply.author_name)}</strong><p>${esc(reply.message || 'Conteúdo removido pela política de retenção.')}</p><small>${date(reply.created_at, true)}</small></article>`).join('')}</div></section>` : ''; }
function deadlineNote(ticket) { if (ticket.status === 'awaiting_feedback') return `<small>Confirmação até ${date(ticket.feedback_deadline, true)}</small>`; if (ticket.replied_at) return `<small>Respondido em ${date(ticket.replied_at, true)}</small>`; if (ticket.status === 'active' && ticket.response_due_at) { const late = new Date(ticket.response_due_at) < new Date(); return `<small class="${late ? 'negative-text' : ''}">${late ? 'Resposta vencida' : 'Responder até'} ${date(ticket.response_due_at, true)}</small>`; } return ''; }
function ticketsPage() {
  const client = state.user.role === 'client';
  const supervisor = state.user.role === 'supervisor';
  const tickets = state.data.tickets;
  const alerts = (state.data.notifications || []).filter(n => n.ticket_id && ['response', 'overdue', 'response_overdue', 'response_due', 'due_soon'].includes(n.type));
  return `${!client && alerts.length ? `<section class="attention-list" aria-label="Lembretes de resposta">${alerts.slice(0, 3).map(n => `<div class="attention-item ${new Date(n.due_at) < new Date() ? 'overdue' : ''}"><div><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p></div>${!supervisor ? link('Responder →', `registrar?id=${n.ticket_id}`, 'text-link') : ''}</div>`).join('')}</section>` : ''}<div class="section-head"><div><h2>${client ? 'Estamos com você em cada atendimento' : 'Atendimentos e conexões'}</h2><p>${tickets.length} registros disponíveis para sua conta</p></div>${state.user.role === 'attendant' ? link(`${icon('e485c')}Registrar atendimento`, 'registrar') : ''}</div><div class="card table-wrap">${tickets.length ? `<table class="data-table"><thead><tr><th>Protocolo</th><th>Assunto</th>${!client ? '<th>Cliente</th>' : ''}<th>Canal</th><th>Status</th><th>Data</th><th><span class="small">Ação</span></th></tr></thead><tbody>${tickets.map(t => `<tr><td><strong>${esc(t.protocol)}</strong></td><td class="subject-col">${esc(t.subject)}${client || supervisor ? `<small>Atendente: ${esc(t.attendant_name)}</small>` : ''}</td>${!client ? `<td>${esc(t.client_name)}</td>` : ''}<td>${esc(t.channel)}</td><td>${badge(t.status)}${deadlineNote(t)}</td><td>${date(t.created_at)}</td><td class="action-col">${client ? clientTicketActions(t) : supervisor ? `<button class="text-link" data-action="ticket-detail" data-id="${t.id}">Ver atendimento →</button>` : link(`Atualizar ${icon('cab3b', 15)}`, `registrar?id=${t.id}`, 'text-link')}</td></tr>${client && state.quickId === t.id ? `<tr class="quick-row"><td colspan="6">${quickFeedbackForm(t)}</td></tr>` : ''}`).join('')}</tbody></table>` : empty('Nenhum atendimento por aqui.', client ? 'Seus atendimentos aparecerão aqui assim que forem registrados.' : 'Registre o primeiro atendimento para começar.')}</div>${client ? `<div class="banner compact"><p>Você pode confirmar a solução ou avisar que ainda precisa de ajuda diretamente aqui. Sem links externos.</p></div>` : ''}`;
}
function rating(name = 'rating', value = '') { return `<div class="rating-group" role="group" aria-label="Nota do atendimento, de 1 a 5">${[1, 2, 3, 4, 5].map(n => `<label class="rating-option"><input type="radio" name="${name}" value="${n}" aria-label="Nota ${n} de 5" ${Number(value) === n ? 'checked' : ''} required><span>${n}</span></label>`).join('')}</div>`; }
function quickFeedbackForm(ticket) { return `<form data-form="quick-feedback" data-id="${ticket.id}" class="quick-form"><div class="field"><label>Como foi o atendimento?</label>${rating()}</div>${select(`resolved-${ticket.id}`, 'O problema foi resolvido?', [['', 'Selecione'], ['1', 'Sim, pode encerrar'], ['0', 'Não, ainda preciso de ajuda']], '', 'required')}${btn('Enviar feedback', 'submit-quick', 'btn-primary', 'data-submit="true"')}<small>Leva poucos segundos. Sua resposta é registrada no atendimento.</small></form>`; }
function registerPage() {
  const ticket = state.data.tickets.find(t => Number(t.id) === Number(state.params.get('id')));
  if (state.params.has('id') && !ticket) return empty('Atendimento não encontrado.', 'Ele não está disponível no seu escopo de acesso.');
  const editing = Boolean(ticket);
  const locked = editing && ['resolved', 'closed_no_response'].includes(ticket.status);
  state.selectedCategory = ticket?.category_id || null;
  return `${editing ? `<div class="ticket-edit-head"><strong>${esc(ticket.protocol)}</strong>${badge(ticket.status)}<small>Registrado em ${date(ticket.created_at, true)}</small></div>` : ''}<section class="card form-card"><h2>${editing ? 'Tudo sobre esta conversa.' : 'Uma nova conversa começa aqui.'}</h2><p>${editing ? 'Atualize as informações e acompanhe a solução neste mesmo lugar.' : 'Vincule o atendimento a um cliente. Você será o atendente responsável.'}</p><form id="ticket-form" data-id="${ticket?.id || ''}"><div class="form-grid"><div class="field full"><label for="client_id">Cliente</label><select id="client_id" name="client_id" required ${editing ? 'disabled' : ''}><option value="">Selecione o cliente</option>${state.data.clients.map(c => `<option value="${c.id}" ${Number(ticket?.client_id) === Number(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div class="field full"><label for="subject">Assunto</label><div class="input-relative"><input id="subject" name="subject" value="${esc(ticket?.subject || '')}" placeholder="Comece a digitar, por exemplo: VPN" minlength="5" maxlength="180" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="subject-suggestions" required ${locked ? 'disabled' : ''}><div id="subject-suggestions" class="autocomplete-list" role="listbox" hidden></div></div><small>Busque assuntos e soluções já registrados no banco.</small></div>${select('channel', 'Canal', ['Portal', 'Telefone', 'E-mail', 'Chat'], ticket?.channel || 'Portal', locked ? 'disabled' : '')}${input('response_due_at', 'Prazo para responder ao cliente', 'datetime-local', localInput(ticket?.response_due_at || new Date(Date.now() + 4 * 3600000).toISOString()), `required ${locked ? 'disabled' : ''}`, 'Você receberá um lembrete na plataforma.')}</div><div id="related-cases" class="related-cases"></div><div class="form-actions"><small>${editing ? 'O status acompanha o fluxo de solução automaticamente.' : 'Registrado na sua equipe, sem etapas extras.'}</small>${locked ? '<span class="badge resolved">Registro encerrado</span>' : `<button type="submit" class="btn btn-primary">${editing ? 'Salvar alterações' : 'Registrar atendimento'} ${icon('2bccc', 15)}</button>`}</div></form></section>${editing ? solutionSection(ticket) : ''}`;
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
function filtersForm(compact = false) {
  const values = state.filters;
  const attendants = [...new Map(state.data.tickets.map(t => [t.attendant_id, { id: t.attendant_id, name: t.attendant_name }])).values()];
  const scopeFields = `${state.user.role === 'manager' ? select('team_id', 'Equipe', [['', 'Todas'], ...state.data.teams.map(t => [t.id, t.name])], values.team_id) : ''}${select('client_id', 'Cliente', [['', 'Todos'], ...state.data.clients.map(t => [t.id, t.name])], values.client_id)}${state.user.role !== 'attendant' ? select('attendant_id', 'Atendente', [['', 'Todos'], ...attendants.map(t => [t.id, t.name])], values.attendant_id) : ''}`;
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
  if (statisticsTarget) statisticsTarget.replaceWith(template.content.querySelector('.stats'));
  if (resultsTarget) resultsTarget.replaceWith(template.content.querySelector('#report-results'));
}
function feedbackTable(feedbacks) {
  const client = state.user.role === 'client';
  return `<div class="card table-wrap" id="feedback-list">${feedbacks.length ? `<table class="data-table"><thead><tr><th>Feedback</th><th>Atendimento</th>${!client ? '<th>Sentimento</th><th>Criticidade</th>' : ''}<th>Origem</th><th>Recebido em</th><th>Ação</th></tr></thead><tbody>${feedbacks.map(f => `<tr class="${f.sentiment === 'negative' ? 'negative-row' : ''}"><td><strong>${esc(f.protocol)}</strong><small>${client ? esc(String(f.text || f.transcript || (f.mode === 'quick' ? `Nota ${f.rating} de 5` : 'Feedback em áudio')).slice(0, 52)) : esc(f.client_name)}</small></td><td class="subject-col">${esc(f.subject)}${!client ? `<small>${esc(f.attendant_name)}</small>` : ''}</td>${!client ? `<td>${badge(f.sentiment, sentimentNames)}</td><td>${badge(f.criticality, criticalityNames)}${f.reviewed ? '<small>Revisado</small>' : ''}</td>` : ''}<td>${esc(modeNames[f.mode] || f.mode)}${analysisStatus(f)}</td><td>${date(f.created_at, !client)}</td><td class="action-col"><button class="text-link" data-action="feedback-detail" data-id="${f.id}">${state.user.role === 'supervisor' ? 'Revisar' : 'Ver detalhes'} ${icon('2f5af', 15)}</button></td></tr>`).join('')}</tbody></table>` : empty('Nenhum feedback encontrado.', 'Os registros aparecerão aqui quando o cliente compartilhar sua experiência.')}</div>`;
}
function feedbacksPage() { const feedbacks = filteredFeedbacks(); return `${state.user.role !== 'client' ? filtersForm(true) : ''}<div class="section-head"><div><h2>Cada feedback conta uma história</h2><p>${feedbacks.length} registros no seu escopo de acesso</p></div>${state.user.role === 'client' ? link(`Enviar feedback ${icon('9b528', 15)}`, 'enviar-feedback') : ''}</div>${feedbackTable(feedbacks)}`; }
function criticalPage() { const items = filteredFeedbacks().filter(f => f.criticality === 'critical'); return `${filtersForm(true)}<div class="banner banner-warning compact">${icon('20913')}<p>Sinais automáticos precisam de avaliação humana. Sentimento negativo, por si só, não determina alta criticidade. Revise cada caso antes de confirmar a classificação.</p></div><div class="section-head"><div><h2>Um olhar atento faz a diferença</h2><p>${items.length} registros no seu escopo de acesso</p></div></div>${feedbackTable(items)}`; }
function feedbackFormPage() {
  const tickets = state.data.tickets.filter(canFeedback);
  const selected = num(state.params.get('ticket')) || tickets[0]?.id;
  if (!tickets.length) return `<section class="card success-card"><div class="success-check">✓</div><h2>Está tudo em dia por aqui.</h2><p>Não há atendimentos pendentes de avaliação. Obrigado por compartilhar sua experiência.</p>${link('Ver meus atendimentos', 'atendimentos')}</section>`;
  return `<section class="card feedback-card"><h3>Queremos ouvir você.</h3><p class="small" style="margin-top:5px">Conte como foi o atendimento. Você escolhe como compartilhar.</p><form id="feedback-form"><div class="form-grid">${select('ticket_id', 'Atendimento', tickets.map(t => [t.id, `${t.protocol} · ${t.subject}`]), selected, 'required')}<div class="field"><label>Como foi o atendimento?</label>${rating()}</div>${select('resolved', 'O problema foi resolvido?', [['', 'Selecione'], ['1', 'Sim, pode encerrar'], ['0', 'Não, ainda preciso de ajuda']], '', 'required')}<div class="field full"><label>Como deseja enviar?</label><div class="mode-tabs"><button type="button" class="btn selected" data-action="feedback-mode" data-mode="text" aria-pressed="true">${icon('0b772')}Escrever</button><button type="button" class="btn" data-action="feedback-mode" data-mode="audio" aria-pressed="false">${icon('c1f96')}Gravar áudio</button></div><small>Escolha uma opção. Limpe o conteúdo para trocar de formato.</small></div><div id="feedback-content" class="field full">${textFeedbackContent()}</div></div><label class="confirmation"><input type="checkbox" name="confirmed" required><span>Revisei meu feedback e confirmo o envio.</span></label><div class="form-actions"><small>Sua resposta será registrada diretamente no atendimento.</small><button type="submit" class="btn btn-primary">Enviar feedback ${icon('32f8c', 15)}</button></div></form></section>`;
}
function textFeedbackContent() { return `<label for="feedback-text">Seu feedback</label><textarea id="feedback-text" name="text" rows="4" maxlength="500" required placeholder="Em poucas palavras, conte como foi sua experiência."></textarea><small id="feedback-counter">0 de 500 caracteres · até 5 linhas</small><button type="button" class="text-link" data-action="clear-feedback">Limpar conteúdo e trocar formato</button>`; }
function audioFeedbackContent() { return `<div class="recording" id="recording-panel"><div class="recording-indicator" id="recording-time">Sua voz também importa.</div><p class="small">Grave um feedback de até 60 segundos. O microfone só será ativado ao iniciar.</p><div class="waveform" aria-hidden="true">${'<i></i>'.repeat(32)}</div><div id="audio-preview"></div><div class="button-row"><button type="button" class="btn" data-action="record-start" id="record-start">Iniciar gravação</button><button type="button" class="btn btn-danger" data-action="record-stop" id="record-stop" hidden>Parar gravação ${icon('13bd2', 15)}</button></div><p class="progress-note">Após o envio, o áudio será transcrito e analisado automaticamente neste computador. A equipe poderá revisar o resultado.</p></div><button type="button" class="text-link" data-action="clear-feedback">Descartar áudio e trocar formato</button>`; }
function stat(label, value, sub = '', type = '', file = '') { return `<article class="card stat"><div class="stat-label">${esc(label)}</div><div class="stat-value ${type === 'red' ? 'negative-text' : ''}">${esc(value)}</div><small>${sub}</small>${file ? `<span class="stat-icon ${type}">${icon(file)}</span>` : ''}</article>`; }
function statistics(r) { return `<div class="stats">${stat('Feedbacks recebidos', num(r.received), 'Vozes reunidas em um só lugar', '', '04eb3')}${stat('Feedbacks analisados', num(r.analyzed), 'Classificação concluída', '', 'c8fec')}${stat('Sentimentos positivos', `${num(r.positive_percent)}%`, `${num(r.sentiments?.positive)} positivos no período`, '', '049d2')}${stat('Casos críticos', num(r.critical), 'Acompanhamento humano necessário', 'red', 'ddda8')}</div>`; }
function charts(r) {
  const trend = r.trend || [];
  const max = Math.max(...trend.map(t => num(t.positive) + num(t.neutral) + num(t.negative)), 1);
  const s = r.sentiments || {};
  const total = num(s.positive) + num(s.neutral) + num(s.negative);
  const positive = total ? num(s.positive) / total * 100 : 0;
  const neutral = total ? num(s.neutral) / total * 100 : 0;
  const trendMarkup = `<section class="card chart-card"><h3>Evolução dos sentimentos</h3><p>A voz dos clientes ao longo do período</p>${trend.length ? `<div class="bar-chart" role="img" aria-label="${esc(trend.map(t => `${date(t.date)}: ${num(t.positive)} positivos, ${num(t.neutral)} neutros e ${num(t.negative)} negativos`).join('; '))}">${trend.map(t => `<div class="bar-column" title="${esc(date(t.date))}"><div class="bar-part negative" style="height:${num(t.negative) / max * 100}%"></div><div class="bar-part neutral" style="height:${num(t.neutral) / max * 100}%"></div><div class="bar-part" style="height:${num(t.positive) / max * 100}%"></div></div>`).join('')}</div><div class="chart-dates"><span>${date(trend[0].date)}</span><span>${date(trend.at(-1).date)}</span></div>` : empty('Ainda sem dados no período.')}<div class="legend"><span><i></i>Positivo</span><span><i class="neutral"></i>Neutro</span><span><i class="negative"></i>Negativo</span></div></section>`;
  const distributionMarkup = `<section class="card chart-card"><h3>Distribuição de sentimentos</h3><p>Classificações dos feedbacks analisados</p><div class="donut-layout"><div class="donut" role="img" aria-label="${num(s.positive)} positivos, ${num(s.neutral)} neutros, ${num(s.negative)} negativos" style="background:${total ? `conic-gradient(#5da77e 0% ${positive}%,#e7cc75 ${positive}% ${positive + neutral}%,#e49882 ${positive + neutral}% 100%)` : '#edf1f6'}"><div class="donut-value"><strong>${total}</strong><small>analisados</small></div></div><div class="donut-legend">${[['positive', 'Positivo'], ['neutral', 'Neutro'], ['negative', 'Negativo']].map(([key, label]) => `<div><i class="${key}"></i><span>${label}</span><strong>${total ? Math.round(num(s[key]) / total * 100) : 0}% <small>(${num(s[key])})</small></strong></div>`).join('')}</div></div></section>`;
  return state.route === 'indicadores' ? `${trendMarkup}<div class="chart-grid equal">${distributionMarkup}${topicCard(r)}</div>` : `<div class="chart-grid">${trendMarkup}${distributionMarkup}</div>`;
}
function topicCard(r) {
  const topics = (r.topics || []).slice(0, 5);
  const max = Math.max(...topics.map(t => num(t.count)), 1);
  return `<section class="card chart-card"><h3>Assuntos que mais aparecem</h3><p>Temas identificados nas análises</p>${topics.length ? topics.map(t => `<div class="topic-row"><div><span>${esc(t.subject)}</span><small>${num(t.count)} feedbacks</small></div><div class="topic-track"><span style="width:${num(t.count) / max * 100}%"></span></div></div>`).join('') : empty('Ainda sem assuntos para mostrar.')}</section>`;
}
function careCard(r) { return `<section class="card chart-card"><h3>Atenção que vira cuidado</h3><p>Acompanhe a resolução dos atendimentos</p><div class="care-stats"><div><strong>${num(r.awaiting_feedback)}</strong><small>Aguardando cliente</small></div><div><strong>${num(r.resolved)}</strong><small>Resolvidos</small></div><div><strong>${num(r.closed_no_response)}</strong><small>Sem retorno</small></div></div><div class="banner banner-warning compact"><p>Encerramentos sem retorno são separados de resoluções confirmadas pelo cliente.</p></div></section>`; }
function topicsAndCare(r) { return `<div class="chart-grid equal">${topicCard(r)}${careCard(r)}</div>`; }
function teamsTable(r) { return `<div class="card table-wrap">${r.teams?.length ? `<table class="data-table"><thead><tr><th>Equipe</th><th>Recebidos</th><th>Analisados</th><th>Positivos</th><th>Críticos</th><th>Resolvidos</th></tr></thead><tbody>${r.teams.map(t => `<tr><td><strong>${esc(t.name)}</strong></td><td>${num(t.received)}</td><td>${num(t.analyzed)}</td><td>${num(t.positive)}</td><td>${t.critical ? `<span class="badge critical">${num(t.critical)}</span>` : '0'}</td><td><span class="badge positive">${num(t.resolved)}</span></td></tr>`).join('')}</tbody></table>` : empty('Nenhuma equipe neste período.')}</div>`; }
function teamComparisons(r) {
  return `<div class="chart-grid equal">${[['Sentimentos positivos', 'Percentual de positivos entre os feedbacks analisados', 'positive', 'analyzed'], ['Casos críticos resolvidos', 'Percentual de feedbacks críticos com atendimento resolvido', 'critical_resolved', 'critical']].map(([title, subtitle, part, total]) => `<section class="card chart-card"><h3>${title}</h3><p>${subtitle}</p>${r.teams?.length ? r.teams.map(team => { const percent = num(team[total]) ? Math.round(num(team[part]) / num(team[total]) * 100) : 0; return `<div class="topic-row"><div><span>${esc(team.name)}</span><small>${percent}% (${num(team[part])} de ${num(team[total])})</small></div><div class="topic-track"><span style="width:${percent}%"></span></div></div>`; }).join('') : empty('Nenhuma equipe neste período.')}</section>`).join('')}</div>`;
}
function reportPage() {
  const r = state.report;
  const personal = state.user.role === 'attendant';
  const supervisor = state.user.role === 'supervisor';
  const reportRoute = ['relatorios', 'relatorio'].includes(state.route);
  const comparison = state.route === 'equipes';
  const indicators = state.route === 'indicadores';
  const title = personal ? 'Seu atendimento em perspectiva' : comparison ? 'Cada equipe, uma contribuição' : reportRoute ? 'Exporte o que você precisa' : indicators ? 'O que os feedbacks nos mostram' : 'A experiência em perspectiva';
  const heading = `<div class="section-head"><div><h2>${title}</h2><p>${personal ? 'Somente os indicadores dos seus atendimentos.' : comparison ? 'Compare os resultados das equipes sem expor dados pessoais.' : indicators ? 'Como os sentimentos evoluem dia a dia na organização.' : 'Indicadores calculados a partir dos registros do banco.'}</p></div><a href="/api/reports/export?${esc(new URLSearchParams(state.filters))}" class="btn ${reportRoute ? 'btn-primary' : ''}" download>Exportar atendimentos filtrados ${icon(reportRoute ? 'b6552' : 'dabc1', 15)}</a></div>`;
  const types = reportRoute ? `<div class="report-type">${btn('Relatório básico', 'report-type', !state.filters.type || state.filters.type === 'general' ? 'selected' : '', 'data-type="general"')}${btn('Relatório de criticidade', 'report-type', state.filters.type === 'criticality' ? 'selected' : '', 'data-type="criticality"')}</div>` : '';
  const reportInfo = `<section class="card chart-card export-info"><h3>O que vai no arquivo CSV</h3><p>Atendimentos no seu escopo, respeitando os filtros atuais</p><div class="export-fields"><span>Protocolo e assunto do atendimento</span><span>Equipe e canal de atendimento</span><span>Status e data de abertura</span><span>Motivo do encerramento</span></div><div class="banner compact"><p>O CSV contém atendimentos individuais. Gravações, transcrições, evidências e texto dos feedbacks não são exportados.</p></div></section>`;
  const overdue = (personal || supervisor) && r.response_overdue?.length ? `<div class="section-head"><div><h2>Prazos que precisam de atenção</h2><p>Lembretes para responder ao cliente.</p></div></div><div class="card table-wrap"><table class="data-table"><thead><tr><th>Atendimento</th><th>Assunto</th><th>Prazo</th><th>Ação</th></tr></thead><tbody>${r.response_overdue.map(t => `<tr><td><strong>${esc(t.protocol)}</strong></td><td>${esc(t.subject)}</td><td class="negative-text">${date(t.response_due_at, true)}</td><td>${personal ? link('Responder →', `registrar?id=${t.id}`, 'text-link') : `<button class="text-link" data-action="ticket-detail" data-id="${t.id}">Ver atendimento →</button>`}</td></tr>`).join('')}</tbody></table></div>` : '';
  const previewHeading = `<div class="section-head"><div><h2>${reportRoute ? 'Prévia do relatório' : comparison ? 'Comparação entre equipes' : 'Conexões entre equipes'}</h2><p>Indicadores agregados das equipes, sem dados pessoais.</p></div>${!supervisor && !comparison && !reportRoute ? link(`Ver comparação ${icon('2f5af', 15)}`, 'equipes', 'text-link') : ''}</div>`;
  const results = reportRoute ? `${state.filters.type === 'criticality' ? `<div class="section-head"><div><h2>Relatório de criticidade</h2><p>Casos que precisam de atenção e acompanhamento.</p></div></div>${criticalReport(r)}` : `${previewHeading}${teamsTable(r)}`}${reportInfo}` : comparison ? `${previewHeading}${teamsTable(r)}${teamComparisons(r)}` : `${charts(r)}${indicators ? '' : topicsAndCare(r)}${!personal && !indicators ? `${previewHeading}${teamsTable(r)}` : ''}${overdue}`;
  return `${heading}${types}${filtersForm()}${statistics(r)}<div id="report-results">${results}</div><p class="report-note" style="margin-top:20px">${reportRoute ? 'O CSV respeita os filtros e o seu escopo de acesso. Encerrados sem retorno não contam como resolvidos.' : 'A IA apoia a avaliação humana. Os detalhes distinguem resultados do modelo, avaliações por nota e exemplos de demonstração.'}</p>`;
}
function criticalReport(r) { const items = r.critical_cases || []; return `<div class="card table-wrap">${items.length ? `<table class="data-table"><thead><tr><th>Atendimento</th><th>Assunto</th><th>Sentimento</th><th>Criticidade</th><th>Revisão</th></tr></thead><tbody>${items.map(t => `<tr class="negative-row"><td><strong>${esc(t.ticket_protocol || t.protocol)}</strong></td><td>${esc(t.subject)}</td><td>${badge(t.sentiment, sentimentNames)}</td><td>${badge(t.criticality || 'critical', criticalityNames)}</td><td>${t.reviewed ? 'Revisado' : 'Aguardando avaliação'}</td></tr>`).join('')}</tbody></table>` : empty('Nenhum caso crítico neste período.')}</div>`; }
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
async function openTicket(id) {
  const t = state.data.tickets.find(t => Number(t.id) === Number(id));
  if (!t) return;
  const client = state.user.role === 'client';
  openDialog(`<div class="dialog-title-row"><div><div class="eyebrow">${esc(t.protocol)}</div><h2 id="dialog-title">${esc(t.subject)}</h2></div><button class="dialog-close" data-action="modal-close" aria-label="Fechar atendimento">×</button></div><p class="dialog-sub">${esc(t.client_name)} · ${esc(t.attendant_name)} · ${esc(t.channel)}</p><div class="button-row" style="margin-top:18px">${badge(t.status)}</div><dl class="description-list"><dt>Registro</dt><dd>${date(t.created_at, true)}</dd><dt>Responder até</dt><dd>${date(t.response_due_at, true)}</dd><dt>Confirmação até</dt><dd>${t.feedback_deadline ? date(t.feedback_deadline, true) : 'Ainda sem solução enviada'}</dd></dl>${t.solution ? `<section class="dialog-section"><h3>Solução enviada pela equipe</h3><div class="feedback-quote">${esc(t.solution)}</div></section>` : ''}${repliesBlock(t)}${!client ? '<section class="dialog-section"><h3>Cases de resolução relacionados</h3><div id="ticket-cases">Consultando a base...</div></section>' : ''}${state.user.role === 'supervisor' && t.status === 'active' && t.rejected_at ? retryForm(t) : ''}<div class="modal-footer">${btn('Fechar', 'modal-close')}</div>`);
  if (client) return;
  try { const cases = await api(`/tickets/${id}/cases`); const target = dialog.querySelector('#ticket-cases'); if (target) target.innerHTML = caseCards(Array.isArray(cases) ? cases : cases.cases || []); }
  catch (error) { const target = dialog.querySelector('#ticket-cases'); if (target) target.innerHTML = `<p class="small">${esc(error.message)}</p>`; }
}
function notificationsDialog() { const list = state.data.notifications || []; openDialog(`<div class="dialog-title-row"><div><div class="eyebrow">Sua rotina, com mais cuidado</div><h2 id="dialog-title">Alertas e lembretes</h2></div><button class="dialog-close" data-action="modal-close" aria-label="Fechar alertas">×</button></div><p class="dialog-sub">Lembretes aparecem na plataforma. Nenhuma mensagem externa é enviada.</p><div class="notification-list" style="margin-top:20px">${list.length ? list.map(n => `<article class="notification-item ${n.due_at && new Date(n.due_at) < new Date() ? 'overdue' : ''}"><h3>${esc(n.title)}</h3><p>${esc(n.message)}</p>${n.due_at ? `<small>${date(n.due_at, true)}</small>` : ''}${n.ticket_id && state.user.role === 'attendant' ? `<div style="margin-top:8px"><a href="#registrar?id=${num(n.ticket_id)}" class="text-link" data-action="notification-open">Ver atendimento →</a></div>` : ''}</article>`).join('') : '<p class="notification-empty">Tudo em dia. Não há novos alertas para você.</p>'}</div>`); }
function clearAudio() { if (state.audio?.url) URL.revokeObjectURL(state.audio.url); state.audio = null; }
function updateModeLock() { const text = document.querySelector('#feedback-text')?.value || ''; document.querySelectorAll('[data-action="feedback-mode"]').forEach(button => { button.disabled = (state.formMode !== button.dataset.mode) && Boolean(text || state.audio || state.recording); }); }
function clearFeedback() { stopRecording(true); clearAudio(); const input = document.querySelector('#feedback-text'); if (input) input.value = ''; const target = document.querySelector('#feedback-content'); if (target) target.innerHTML = state.formMode === 'audio' ? audioFeedbackContent() : textFeedbackContent(); updateModeLock(); }
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
    if (form.id === 'ticket-form') { const payload = { subject: data.subject, channel: data.channel, response_due_at: data.response_due_at ? new Date(data.response_due_at).toISOString() : null }; if (!form.dataset.id) payload.client_id = num(data.client_id); if (state.selectedCategory) payload.category_id = state.selectedCategory; const result = await api(form.dataset.id ? `/tickets/${form.dataset.id}` : '/tickets', { method: form.dataset.id ? 'PATCH' : 'POST', body: payload }); await refreshData(); toast(form.dataset.id ? 'Informações do atendimento atualizadas.' : `Atendimento registrado. Protocolo: ${result.protocol || result.ticket?.protocol || 'disponível na lista'}`); if (!form.dataset.id && result.id) location.hash = `registrar?id=${result.id}`; else await render(); return; }
    if (form.id === 'solution-form') { await api(`/tickets/${form.dataset.id}/solution`, { method: 'POST', body: { solution: data.solution } }); await refreshData(); toast('Solução enviada. Agora o sistema aguarda a confirmação do cliente.'); await render(); return; }
    if (form.id === 'reply-form') { await api(`/tickets/${form.dataset.id}/reply`, { method: 'POST', body: { message: data.message } }); await refreshData(); toast('Resposta registrada e disponível ao cliente.'); await render(); return; }
    if (form.id === 'filters-form') { if (data.from && data.to && data.from > data.to) throw new Error('A data inicial precisa ser anterior ou igual à data final.'); state.filters = { ...Object.fromEntries(Object.entries(data).filter(([, v]) => v)), ...(state.filters.type ? { type: state.filters.type } : {}) }; if (['feedbacks', 'criticos'].includes(state.route)) shell(state.route === 'criticos' ? criticalPage() : feedbacksPage()); else { state.report = await api(`/reports?${new URLSearchParams(state.filters)}`); document.querySelector('#page-content').innerHTML = reportPage(); } toast('Filtros aplicados.'); return; }
    if (form.id === 'review-form') { const id = num(form.dataset.id); await api(`/feedbacks/${id}/review`, { method: 'POST', body: { sentiment: data.review_sentiment, criticality: data.review_criticality, justification: data.justification, action: data.action } }); await refreshData(); toast('Revisão salva no histórico.'); await openFeedback(id); return; }
    if (form.id === 'retry-form') { await api(`/tickets/${form.dataset.id}/retry`, { method: 'POST', body: { solution: data.retry_solution, justification: data.retry_justification } }); await refreshData(); closeDialog(); toast('Nova tentativa autorizada. O cliente já pode confirmar a nova solução.'); await render(); return; }
    if (form.id === 'feedback-form' || form.dataset.form === 'quick-feedback') {
      const quick = form.dataset.form === 'quick-feedback'; const ticketId = quick ? num(form.dataset.id) : num(data.ticket_id); const resolved = data[quick ? `resolved-${ticketId}` : 'resolved'] === '1';
      let payload;
      if (!quick && state.recording) throw new Error('Pare a gravação e ouça seu feedback antes de enviar.');
      if (!quick && state.formMode === 'audio') { if (!state.audio) throw new Error('Grave seu feedback antes de enviar.'); payload = new FormData(); payload.append('ticket_id', ticketId); payload.append('rating', data.rating); payload.append('resolved', resolved ? '1' : '0'); payload.append('mode', 'audio'); payload.append('audio', state.audio.blob, 'feedback.wav'); }
      else { const text = quick ? '' : (data.text || '').trim(); if (!quick && (!text || text.length > 500 || text.split(/\r?\n/).length > 5)) throw new Error('Escreva um feedback com até 500 caracteres e 5 linhas.'); payload = { ticket_id: ticketId, rating: num(data.rating), resolved, mode: quick ? 'quick' : 'text', ...(quick ? {} : { text }) }; }
      const received = await api('/feedbacks', { method: 'POST', body: payload }); clearAudio(); await refreshData(); state.quickId = null; if (quick) { toast(resolved ? 'Obrigado! Sua confirmação foi registrada.' : 'Obrigado! A equipe foi informada de que você ainda precisa de ajuda.'); shell(ticketsPage()); } else { document.querySelector('#page-content').innerHTML = `<section class="card success-card"><div class="success-check">✓</div><div class="eyebrow">Feedback recebido</div><h2>Obrigado por compartilhar sua experiência.</h2><p>${resolved ? 'Feedback recebido. Sua confirmação foi registrada no atendimento.' : 'Feedback recebido. A equipe seguirá acompanhando o problema com você.'}</p><div class="receipt-protocol"><small>Protocolo</small><strong>${esc(received.protocol || 'Disponível em meus feedbacks')}</strong></div><div class="button-row" style="justify-content:center">${link('Ver meus feedbacks', 'feedbacks')}${link('Meus atendimentos', 'atendimentos', 'btn')}</div></section>`; } return;
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
    else if (action === 'menu' || action === 'menu-close') { const open = action === 'menu' && !document.querySelector('.sidebar').classList.contains('open'); document.querySelector('.sidebar').classList.toggle('open', open); document.querySelector('.mobile-backdrop').classList.toggle('open', open); document.querySelector('.menu-btn').setAttribute('aria-expanded', String(open)); }
    else if (action === 'notifications') notificationsDialog();
    else if (action === 'modal-close' || action === 'notification-open') closeDialog();
    else if (action === 'refresh') { state.data = null; await init(); }
    else if (action === 'quick-feedback') { state.quickId = state.quickId === num(target.dataset.id) ? null : num(target.dataset.id); shell(ticketsPage()); document.querySelector('.quick-form input')?.focus(); }
    else if (action === 'submit-quick') submitForm(target.closest('form'));
    else if (action === 'feedback-detail') await openFeedback(target.dataset.id);
    else if (action === 'ticket-detail') await openTicket(target.dataset.id);
    else if (action === 'retry-analysis') { target.disabled = true; try { await api(`/feedbacks/${num(target.dataset.id)}/retry-analysis`, { method: 'POST' }); await refreshData(); updateAnalysisViews(); toast('Análise adicionada novamente à fila.'); } finally { target.disabled = false; } }
    else if (action === 'apply-case') { const c = state.caseResults.find(c => Number(c.id) === Number(target.dataset.id)); if (c) { document.querySelector('#subject').value = c.subject; state.selectedCategory = c.category_id; document.querySelector('#subject-suggestions').hidden = true; document.querySelector('#subject').setAttribute('aria-expanded', 'false'); const solution = document.querySelector('#solution'); if (solution && !solution.value) solution.value = c.solution; toast('Assunto preenchido a partir do case de resolução.'); } }
    else if (action === 'feedback-mode') changeMode(target.dataset.mode);
    else if (action === 'clear-feedback') clearFeedback();
    else if (action === 'record-start') await startRecording();
    else if (action === 'record-stop') stopRecording();
    else if (action === 'clear-filters') { state.filters = {}; await render(); }
    else if (action === 'report-type') { state.filters.type = target.dataset.type; state.report = await api(`/reports?${new URLSearchParams(state.filters)}`); document.querySelector('#page-content').innerHTML = reportPage(); }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'subject') { state.selectedCategory = null; clearTimeout(caseTimer); const q = event.target.value; caseTimer = setTimeout(() => loadRelatedCases(q), 240); }
  if (event.target.id === 'feedback-text') { const lines = event.target.value.split(/\r?\n/); if (lines.length > 5) event.target.value = lines.slice(0, 5).join('\n'); document.querySelector('#feedback-counter').textContent = `${event.target.value.length} de 500 caracteres · até 5 linhas`; updateModeLock(); }
});
document.addEventListener('keydown', event => { if (event.target.id === 'subject') { const list = document.querySelector('#subject-suggestions'); if (event.key === 'Escape') { list.hidden = true; event.target.setAttribute('aria-expanded', 'false'); } if (event.key === 'ArrowDown' && !list.hidden) { event.preventDefault(); list.querySelector('button')?.focus(); } } });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });
dialog.addEventListener('cancel', () => { state.modalFeedbackId = null; });
window.addEventListener('hashchange', () => { if (dialog.open) closeDialog(); state.quickId = null; state.filters = {}; render(); });
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
