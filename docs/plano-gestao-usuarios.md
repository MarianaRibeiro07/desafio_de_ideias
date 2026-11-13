# Gestão de usuários no MVP

## Problema e resultado

Hoje nenhuma rota cria usuário: todas as contas vêm do seed (`src/App.php:85-87`).
Uma empresa cadastrada pelo atendente nunca consegue responder feedback, porque
não ganha login (`docs/hospedagem.md:271`). Supervisor e gestor também não
conseguem montar a própria equipe.

Resultado esperado até o pitch de 19/11/2026, 14h: cadastrar empresa cria o login
dela; o gestor cria e desativa supervisores; o supervisor cria e desativa
atendentes da própria equipe; usuário desativado perde o acesso na hora, inclusive
com sessão aberta.

## Decisões

Tomadas pelo Saker em 13/11/2026:

- Login único por empresa cliente, criado no cadastro da empresa.
- Gestor cria supervisores; supervisor cria atendentes da própria equipe.
- Contas novas usam a senha padrão `CtiDemo2026!`, sem troca obrigatória. No
  pitch: "na versão final, a conta é ativada por convite no e-mail, com opção de
  entrar com Google ou Microsoft".
- Fora do MVP: solicitação do atendente com aprovação do supervisor para
  cadastrar cliente. Entra como próximo passo na narrativa do pitch.

Tomadas neste plano, a partir do código:

- **Desativar, nunca apagar.** As linhas de `users` são referenciadas por
  atendimentos, revisões, respostas e auditoria. Coluna `active` com padrão 1.
- **Migração pelo mapa `$added` de `src/App.php:68-72`**, que já faz `ALTER TABLE
  ADD COLUMN` guardado por `PRAGMA table_info` em toda request. O `CREATE TABLE`
  de `users` em `database/schema.sqlite.sql` não muda, porque o seed usa INSERT
  posicional (`src/App.php:87`) e quebraria com uma coluna a mais. O
  `database/schema.mysql.sql` recebe a coluna só como documentação.
- **O filtro de ativo fica em `user()` (`src/App.php:250`) e em `login()`
  (`src/App.php:259-261`).** No `user()`, desativado vira 401 e o frontend volta
  ao login (`public/app.js:55`). No login, a resposta é o mesmo 401 genérico de
  senha errada, para não revelar que a conta existe.
- **A empresa ganha o campo `email` obrigatório** em `POST /api/clients`. O
  e-mail não é derivado do nome, porque nomes que diferem por acento colidiriam
  (`tests/backend.php:319-321`). O login nasce na mesma transação `BEGIN
  IMMEDIATE` da empresa. E-mail já usado responde 409 com mensagem própria,
  checado antes do INSERT, para não cair na mensagem de empresa duplicada de
  `src/App.php:354`.
- **Empresas que já existem sem login continuam sem login.** Grupo Aurora (Lucas)
  e Redecom já têm; as demais do seed não são necessárias na demonstração.
- **Auditoria com alvo:** coluna `target_user_id` em `audit_events`, também pelo
  mapa `$added`, nula por padrão. Eventos `user_created`, `user_deactivated` e
  `user_reactivated`. O cadastro da empresa grava `client_created` e
  `user_created`.
- **Reativar existe**, para desfazer engano. Ninguém desativa a si mesmo.
- **Não deixar equipe sem supervisor:** desativar o último supervisor ativo de
  uma equipe responde 409. Sem isso, retry, escalonamento e revisão daquela
  equipe ficam sem ninguém.
- **O gestor escolhe a equipe do supervisor entre as existentes.** Criar equipe
  fica fora do MVP.
- **Usuário desativado some das listas de seleção**, mas o nome continua nos
  atendimentos antigos.

## Situação em 13/11/2026

Por decisão do Saker, as fases 1 e 2 foram feitas no mesmo dia, 13/11. Ambas
estão concluídas e revisadas por um agente independente, em duas rodadas.

Desvios em relação ao plano abaixo:

- **O `email` do cadastro de empresa é opcional na API e obrigatório na tela.**
  Torná-lo obrigatório na API reescreveria mais de 20 testes de cadastro que
  verificam outras regras. Sem e-mail, a empresa é criada sem login, como antes.
- **Regra nova, vinda da revisão: o atendente com atendimento `active` não pode
  ser desativado (409).** Só o atendente responsável envia a solução, e não
  existe transferência de atendimento, então o cliente ficaria sem resposta.
  Atendimento em `awaiting_feedback` não bloqueia, porque o rejeitado volta para a
  supervisão pelo `retry`.
- **Correção de um defeito anterior a esta mudança:** a linha solta
  `.theme-dash.dark ` em `public/styles.css` anulava o fundo escuro de todos os
  cartões do gestor no tema escuro.

Testes ao fim: `tests/backend.php` com 419 de 419; `tests/browser.mjs` com 269 de
270 (a falha é a do login, já conhecida); `tests/clientes.mjs` com 18 de 18;
`tests/http.mjs` com 30 de 30.

Pendente: a fase 3 (backup, deploy e ensaio).

## Fase 1: backend com testes (detalhada)

Toda task segue o fluxo do workspace: teste em `tests/backend.php` primeiro,
rodar e registrar a falha, depois o código. Os testes novos entram depois do
bloco que confere `COUNT(*) FROM users === 9` (`tests/backend.php:34`) e não
mexem nas contagens de `tests/backend.php:43` e `:216`.

### Task 1.1: coluna `active` e bloqueio de acesso

- **Arquivos:** `src/App.php` (mapa `$added`, `user()`, `login()`),
  `tests/backend.php`, `database/schema.mysql.sql`.
- **Testes vermelhos:** banco antigo sem a coluna ganha `active=1` em todos os
  usuários após `initialize()` duas vezes; usuário com `active=0` recebe 401 no
  login com a mesma mensagem de senha errada; sessão aberta de usuário desativado
  recebe 401 na rota seguinte e `GET /api/session` não devolve o usuário.
- **Pronto quando:** os três passam e a suíte inteira continua verde.

### Task 1.2: login da empresa no cadastro

- **Arquivos:** `src/App.php` (`createClient`, `src/App.php:337-358`),
  `tests/backend.php` (inclusive o teste de chaves da resposta em `:210`, que
  muda de propósito).
- **Contrato:** corpo `name`, `city`, `state`, `email`. Resposta 201 com
  `{"id","name","city","state","login":{"email"}}`. Sem `email` ou com e-mail
  inválido: 400. E-mail já usado por qualquer conta: 409 "Este e-mail já tem
  acesso à plataforma.", sem criar a empresa.
- **Testes vermelhos:** cadastro cria usuário `client` com `client_id` da empresa
  e senha padrão, e esse usuário loga e vê o escopo da empresa; e-mail repetido dá
  409 e não deixa empresa nem auditoria; falha no INSERT do usuário desfaz a
  empresa.

### Task 1.3: API de usuários

- **Arquivos:** `src/App.php` (rotas novas em `handle()`, `src/App.php:210-246`),
  `tests/backend.php`.
- **Rotas:**
  - `GET /api/users`: gestor recebe os supervisores; supervisor recebe os
    atendentes da própria equipe; demais perfis 403. Campos `id`, `name`,
    `email`, `team_id`, `active`.
  - `POST /api/users`: gestor envia `name`, `email`, `team_id` e cria
    supervisor; supervisor envia `name`, `email` e cria atendente na própria
    equipe. O perfil criado é decidido pelo servidor, nunca pelo corpo.
  - `POST /api/users/{id}/deactivate` e `/reactivate`: gestor só sobre
    supervisores; supervisor só sobre atendentes da própria equipe; ninguém sobre
    si mesmo (403).
- **Testes vermelhos:** a matriz de permissão por perfil (cada perfil tentando
  cada alvo), o 409 do último supervisor ativo, a auditoria com
  `target_user_id`, o e-mail duplicado, e o atendente criado logando com a senha
  padrão e vendo só a própria equipe.

## Fase 2: telas (épico)

Aba "Equipe" no menu do supervisor e aba "Supervisores" no menu do gestor
(`public/app.js:9-14`), cada uma com tabela de no máximo 4 colunas (nome, e-mail,
situação, ação) e formulário de cadastro. As rotas precisam de um ramo próprio em
`render()` antes do ramo de relatório (`public/app.js:146`). O formulário de
empresa em `public/clientes/` ganha o campo e-mail e, no sucesso, mostra o e-mail
do login e o aviso da senha padrão. O teste `tests/browser.mjs:110-120` visita as
abas novas sozinho; os testes de cadastro entram em `tests/browser.mjs` e
`tests/clientes.mjs`.

## Fase 3: publicação e pitch (épico)

Backup com `php bin/console.php backup` no servidor antes do deploy, porque a
migração mexe no banco que guarda os dois resultados reais do Gemini. Deploy pela
`main` com o comando de `docs/estado-atual.md`, por uma rede que alcance a
Alwaysdata. Conferir pelo endereço `cti-escuta-proxy.vercel.app`. Atualizar
`docs/arquitetura.md` e `docs/estado-atual.md` com a simplificação da senha
padrão e a frase do pitch. Ensaiar a sequência: Helena cria supervisor, o
supervisor cria atendente, o atendente cadastra empresa, a empresa entra e
responde.

## Calendário

| Dia | Entrega |
|---|---|
| sex 13/11 | plano aprovado |
| seg 16/11 | fase 1 verde |
| ter 17/11 | fase 2 verde |
| qua 18/11 | backup, deploy e conferência pelo endereço da Vercel |
| qui 19/11 | ensaio pela manhã; pitch às 14h |

Se a fase 1 atrasar além de segunda, a fase 2 corta a aba do gestor e mantém só
"Equipe" do supervisor e o login da empresa, que fecham o gap mais grave.

## Riscos

- **Migração em produção:** coluna `NOT NULL` com padrão errado tranca todo mundo
  para fora. Mitigação: padrão 1, teste de banco antigo e backup antes.
- **Senha padrão pública:** está na tela de login (`public/app.js:66`). Aceita
  conscientemente para o MVP e dita no pitch.
- **Rede da escola:** bloqueia a Alwaysdata. O deploy precisa de outra rede; a
  apresentação usa o endereço da Vercel.
