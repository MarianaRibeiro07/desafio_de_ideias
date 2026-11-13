'use strict';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const ALLOWED_ROLES = ['attendant', 'supervisor'];
const state = { csrf: '', user: null, clients: [] };
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

function cell(className, label, text) {
  const div = document.createElement('div');
  div.className = className;
  const small = document.createElement('span');
  small.className = 'rotulo';
  small.textContent = label;
  const value = document.createElement('span');
  value.className = 'valor';
  value.textContent = text;
  div.append(small, value);
  return div;
}

function renderList() {
  const term = normalize($('busca').value.trim());
  const items = state.clients.filter(client => !term || normalize(client.name).includes(term) || normalize(client.city).includes(term));
  const list = $('lista');
  list.replaceChildren();
  for (const client of items) {
    const li = document.createElement('li');
    li.className = 'item';
    const place = client.city ? `${client.city}/${client.state ?? ''}`.replace(/\/$/, '') : '-';
    li.append(cell('col-nome', 'Empresa', client.name), cell('col-local', 'Cidade/UF', place));
    list.append(li);
  }
  const empty = $('lista-vazia');
  empty.hidden = items.length > 0;
  empty.textContent = state.clients.length ? 'Nenhum cliente encontrado para essa busca.' : 'Nenhum cliente cadastrado ainda.';
  $('contagem').textContent = `${items.length} de ${state.clients.length} clientes`;
}

async function loadClients() {
  let clients;
  try {
    clients = await api('/clients');
  } catch (error) {
    if (error.status !== 404 && error.status !== 405) throw error;
    clients = (await api('/bootstrap')).clients;
  }
  state.clients = (Array.isArray(clients) ? clients : clients.clients ?? []).slice().sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  renderList();
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
  try { await loadClients(); } catch (error) { setMessage(error.message, true); }
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
  const body = { name: form.elements.name.value.trim(), city: form.elements.city.value.trim(), state: form.elements.state.value, email: form.elements.email.value.trim() };
  if (!body.name || !body.city || !body.state || !body.email) { setMessage('Preencha o nome da empresa, a cidade, a UF e o e-mail de acesso da empresa.', true); return; }
  $('cadastrar').disabled = true;
  try {
    const created = await api('/clients', { method: 'POST', body });
    form.reset();
    setMessage(`Cliente ${body.name} cadastrado com sucesso. Login criado: ${created.login?.email ?? body.email}. A empresa entra com esse e-mail e a senha padrão das contas de demonstração.`);
    await loadClients();
    $('cliente-nome').focus();
  } catch (error) {
    setMessage(error.message, true);
    if ([400, 409].includes(error.status) && /e-mail/i.test(error.message)) $('cliente-email').focus();
  } finally {
    $('cadastrar').disabled = false;
  }
});

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
