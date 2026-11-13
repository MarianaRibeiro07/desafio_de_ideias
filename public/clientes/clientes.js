'use strict';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const ALLOWED_ROLES = ['attendant', 'supervisor'];
const EMAIL_HINT = 'A empresa entra na plataforma com este e-mail e a senha padrão das contas de demonstração.';
const state = { csrf: '', user: null, clients: [], loading: false, loadError: '', editing: null };
const confirmTimers = new WeakMap();
const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const mutation = Boolean(options.method && options.method !== 'GET');
  const headers = { Accept: 'application/json' };
  if (mutation) headers['X-CSRF-Token'] = state.csrf;
  if (options.body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', method: options.method, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.');
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.message || `Não foi possível concluir a operação (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return json.data;
}

function show(view) {
  for (const id of ['carregando', 'login-view', 'acesso-negado', 'app-view']) $(id).hidden = id !== view;
  $('sair').hidden = view === 'login-view' || view === 'carregando';
}

function setMessage(text, isError = false) {
  const box = $('mensagem');
  box.textContent = text;
  box.className = `mensagem${text ? (isError ? ' erro' : ' ok') : ''}`;
}

function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function fillStates() {
  const select = $('cliente-uf');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecione';
  select.append(placeholder);
  for (const uf of UFS) {
    const option = document.createElement('option');
    option.value = uf;
    option.textContent = uf;
    select.append(option);
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionButton(label, action, client, extraClass = '') {
  const button = element('button', `botao botao-pequeno ${extraClass}`.trim(), label);
  button.type = 'button';
  button.dataset.acao = action;
  button.dataset.id = String(client.id);
  return button;
}

function clientCard(client) {
  const li = element('li', 'item');
  li.dataset.id = String(client.id);
  const head = element('div');
  const place = client.city ? `${client.city}/${client.state ?? ''}`.replace(/\/$/, '') : 'Cidade não informada';
  head.append(element('p', 'item-nome', client.name), element('p', 'item-local', place));
  const access = element('p', 'item-acesso');
  if (client.login_email) access.append(element('span', 'etiqueta', 'Acesso'), element('span', '', client.login_email));
  else access.append(element('span', 'etiqueta etiqueta-sem', 'Sem acesso à plataforma'));
  const actions = element('div', 'item-acoes');
  actions.append(actionButton('Editar', 'editar', client));
  if (state.user?.role === 'supervisor') {
    const remove = actionButton(client.has_history ? 'Arquivar' : 'Excluir', 'remover', client, 'botao-perigo');
    remove.dataset.modo = client.has_history ? 'arquivar' : 'excluir';
    actions.append(remove);
  }
  li.append(head, access, actions);
  return li;
}

function listState(kind, title, detail) {
  const box = $('lista-estado');
  box.className = `cartao estado${kind === 'erro' ? ' erro' : ''}`;
  box.replaceChildren();
  if (kind === 'carregando') box.append(element('span', 'spinner'));
  box.append(element('strong', '', title));
  if (detail) box.append(element('span', '', detail));
  if (kind === 'erro') {
    const retry = element('button', 'botao', 'Tentar novamente');
    retry.type = 'button';
    retry.id = 'tentar-novamente';
    box.append(retry);
  }
  box.setAttribute('role', kind === 'erro' ? 'alert' : 'status');
  box.hidden = false;
}

function renderList() {
  const list = $('lista');
  list.replaceChildren();
  $('lista-estado').hidden = true;
  if (state.loading) { listState('carregando', 'Carregando os clientes...'); $('contagem').textContent = ''; return; }
  if (state.loadError) { listState('erro', 'Não foi possível carregar os clientes.', state.loadError); $('contagem').textContent = ''; return; }
  const term = normalize($('busca').value.trim());
  const items = state.clients.filter(client => !term || normalize(client.name).includes(term) || normalize(client.city).includes(term));
  for (const client of items) list.append(clientCard(client));
  if (!items.length) {
    if (state.clients.length) listState('vazio', 'Nenhum cliente encontrado para essa busca.', 'Confira a grafia ou busque pela cidade.');
    else listState('vazio', 'Nenhum cliente cadastrado ainda.', 'Use o formulário acima para cadastrar a primeira empresa.');
  }
  $('contagem').textContent = `${items.length} de ${state.clients.length} clientes`;
}

async function loadClients() {
  state.loading = true; state.loadError = ''; renderList();
  try {
    let clients;
    try {
      clients = await api('/clients');
    } catch (error) {
      if (error.status !== 404 && error.status !== 405) throw error;
      clients = (await api('/bootstrap')).clients;
    }
    state.clients = (Array.isArray(clients) ? clients : clients.clients ?? []).slice().sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  } catch (error) {
    state.loadError = error.message;
  } finally {
    state.loading = false;
    renderList();
  }
}

function setEditing(client) {
  state.editing = client;
  const form = $('cadastro-form');
  const email = $('cliente-email');
  form.reset();
  $('cadastro-titulo').textContent = client ? 'Editar cliente' : 'Novo cliente';
  $('cadastro-apoio').textContent = client ? `Alterando os dados de ${client.name}.` : 'O cadastro cria o acesso da empresa à plataforma.';
  $('cadastrar').textContent = client ? 'Salvar alterações' : 'Cadastrar cliente';
  $('cancelar-edicao').hidden = !client;
  form.closest('.cartao').classList.toggle('editando', Boolean(client));
  // Editar nao cria login: empresa sem acesso fica com o campo de e-mail travado.
  const withoutLogin = Boolean(client) && !client.login_email;
  email.disabled = withoutLogin;
  email.required = !withoutLogin;
  $('cliente-email-dica').textContent = !client ? EMAIL_HINT : withoutLogin ? 'Esta empresa não tem acesso à plataforma.' : 'Trocar o e-mail muda o login da empresa.';
  if (client) {
    $('cliente-nome').value = client.name;
    email.value = client.login_email ?? '';
    $('cliente-cidade').value = client.city ?? '';
    $('cliente-uf').value = client.state ?? '';
    $('cliente-nome').focus();
    form.closest('.cartao').scrollIntoView({ block: 'nearest' });
  }
}

function resetConfirm(button) {
  clearTimeout(confirmTimers.get(button));
  delete button.dataset.confirmar;
  button.textContent = button.dataset.modo === 'arquivar' ? 'Arquivar' : 'Excluir';
}

async function removeClient(button) {
  const archive = button.dataset.modo === 'arquivar';
  // Confirmacao em dois cliques no mesmo botao, sem confirm() do navegador.
  if (button.dataset.confirmar !== '1') {
    button.dataset.confirmar = '1';
    button.textContent = archive ? 'Confirmar arquivamento' : 'Confirmar exclusão';
    clearTimeout(confirmTimers.get(button));
    confirmTimers.set(button, setTimeout(() => resetConfirm(button), 5000));
    return;
  }
  clearTimeout(confirmTimers.get(button));
  const id = Number(button.dataset.id);
  const client = state.clients.find(c => Number(c.id) === id);
  button.disabled = true;
  try {
    await api(archive ? `/clients/${id}/archive` : `/clients/${id}`, { method: archive ? 'POST' : 'DELETE' });
    if (state.editing && Number(state.editing.id) === id) setEditing(null);
    setMessage(archive ? `Cliente ${client?.name ?? ''} arquivado. Os atendimentos antigos continuam com o nome dele.` : `Cliente ${client?.name ?? ''} excluído.`);
    await loadClients();
  } catch (error) {
    resetConfirm(button);
    setMessage(error.message, true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function refreshSession() {
  const session = await api('/session');
  state.csrf = session.csrf_token;
  state.user = session.user;
}

async function enter() {
  if (!state.user) { show('login-view'); $('login-email').focus(); return; }
  if (!ALLOWED_ROLES.includes(state.user.role)) { show('acesso-negado'); return; }
  show('app-view');
  setMessage('');
  setEditing(null);
  await loadClients();
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const box = $('login-erro') ?? Object.assign(document.createElement('p'), { id: 'login-erro', className: 'mensagem erro' });
  box.setAttribute('role', 'alert');
  form.prepend(box);
  box.textContent = '';
  button.disabled = true;
  try {
    await refreshSession();
    await api('/login', { method: 'POST', body: { email: form.elements.email.value.trim(), password: form.elements.password.value } });
    await refreshSession();
    form.reset();
    await enter();
  } catch (error) {
    box.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('cadastro-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const editing = state.editing;
  const sendEmail = !editing || Boolean(editing.login_email);
  const body = { name: form.elements.name.value.trim(), city: form.elements.city.value.trim(), state: form.elements.state.value, ...(sendEmail ? { email: form.elements.email.value.trim() } : {}) };
  if (!body.name || !body.city || !body.state || (sendEmail && !body.email)) { setMessage('Preencha o nome da empresa, o e-mail de acesso da empresa, a cidade e a UF.', true); return; }
  $('cadastrar').disabled = true;
  try {
    if (editing) {
      const saved = await api(`/clients/${Number(editing.id)}`, { method: 'PATCH', body });
      setEditing(null);
      setMessage(`Dados de ${saved.name} atualizados.`);
    } else {
      const created = await api('/clients', { method: 'POST', body });
      form.reset();
      setMessage(`Cliente ${body.name} cadastrado com sucesso. Login criado: ${created.login?.email ?? body.email}. A empresa entra com esse e-mail e a senha padrão das contas de demonstração.`);
      $('cliente-nome').focus();
    }
    await loadClients();
  } catch (error) {
    setMessage(error.message, true);
    if ([400, 409].includes(error.status) && /e-mail/i.test(error.message)) $('cliente-email').focus();
  } finally {
    $('cadastrar').disabled = false;
  }
});

$('cancelar-edicao').addEventListener('click', () => { setEditing(null); setMessage(''); });

$('lista').addEventListener('click', event => {
  const button = event.target.closest('button[data-acao]');
  if (!button || button.disabled) return;
  if (button.dataset.acao === 'editar') {
    const client = state.clients.find(c => Number(c.id) === Number(button.dataset.id));
    if (client) { setMessage(''); setEditing(client); }
  } else if (button.dataset.acao === 'remover') removeClient(button);
});

$('lista-estado').addEventListener('click', event => { if (event.target.id === 'tentar-novamente') loadClients(); });

$('busca').addEventListener('input', renderList);

$('sair').addEventListener('click', async () => {
  try { await api('/logout', { method: 'POST' }); } catch { /* sessão já encerrada */ }
  state.clients = [];
  await refreshSession().catch(() => {});
  state.user = null;
  await enter();
});

async function init() {
  fillStates();
  try {
    await refreshSession();
    await enter();
  } catch (error) {
    show('login-view');
    const box = document.createElement('p');
    box.className = 'mensagem erro';
    box.setAttribute('role', 'alert');
    box.textContent = error.message;
    $('login-form').prepend(box);
  }
}

init();
