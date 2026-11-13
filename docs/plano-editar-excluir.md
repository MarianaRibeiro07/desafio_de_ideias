# Editar, excluir e arquivar contas e empresas

## Problema e resultado

Hoje clientes, atendentes e supervisores só podem ser criados, e os dois últimos
desativados e reativados (`src/App.php:340-422`). Cadastro errado fica para sempre
na lista, e não há como corrigir nome, e-mail ou equipe.

Resultado esperado antes do pitch de 19/11/2026: corrigir os dados de qualquer um
dos três; excluir de verdade quem nunca participou de atendimento; arquivar quem
já participou, preservando o histórico.

## Decisões

Tomada pelo Saker em 13/11/2026: **exclusão real para quem não tem histórico;
com histórico, o botão vira "Arquivar"**.

Tomadas neste plano, a partir do código:

- **O que é histórico.** As chaves estrangeiras estão ligadas
  (`src/App.php:29`). Usuário tem histórico quando aparece em `tickets.attendant_id`,
  `reviews.reviewer_id`, `ticket_replies.user_id` ou `audit_events.user_id`.
  Empresa tem histórico quando aparece em `tickets.client_id`, ou quando o login
  dela tem histórico. Login não grava auditoria, então conta criada e nunca usada
  para operar não tem histórico. A checagem é explícita, para dar mensagem e
  teste; a chave estrangeira continua como rede de segurança.
- **Arquivar é um estado novo, separado de inativo.** Coluna `archived INTEGER
  NOT NULL DEFAULT 0` em `users` e em `clients`, pelo mapa `$added`
  (`src/App.php:68`). Arquivar também põe `active=0`. Arquivado some das listas
  de gestão e de seleção, não volta pela interface e mantém o nome nos
  atendimentos antigos. O e-mail continua reservado, porque a coluna é única.
- **Arquivar e excluir usuário seguem as guardas de desativar**
  (`src/App.php:414-416`): não deixar a equipe sem supervisor ativo e não tirar
  atendente com atendimento `active`.
- **Arquivar empresa** arquiva também o login dela. Fica bloqueado (409) enquanto
  houver atendimento `active` ou `awaiting_feedback`, porque o cliente perderia
  como responder.
- **Excluir empresa** apaga o login junto, na mesma transação.
- **Quem faz o quê.** Usuários: a mesma matriz de desativar (gestor sobre
  supervisores, supervisor sobre atendentes da equipe, ninguém sobre si). Empresa:
  atendente e supervisor editam, como já cadastram; **só o supervisor exclui ou
  arquiva**, porque arquivar tira a empresa da equipe inteira.
- **Editar não cria login** (decisão do Saker em 13/11/2026). Empresa sem login
  que recebe e-mail na edição responde 422 "Esta empresa não tem acesso à
  plataforma." O seed é só para demonstração e some na versão final, então quem
  resolve as empresas do seed sem login é o próprio seed: ganham login as
  empresas 3 a 6, com os usuários 10 Patricia Rocha (`patricia@cti.demo`), 11
  Joao Pereira (`joao@cti.demo`), 12 Renata Campos (`renata@cti.demo`) e 13
  Marcos Vieira (`marcos@cti.demo`). As contagens de usuários nos testes passam
  de 9 para 13 de propósito. O seed só roda em banco vazio, então o banco já
  publicado não muda com isso.
- **O nome do login acompanha o nome da empresa** quando era igual ao nome antigo
  (login criado pelo cadastro). Login com nome de pessoa, como os do seed, não
  muda.
- **Editar supervisor trocando a equipe** não pode deixar a equipe de origem sem
  supervisor ativo (409). E-mail novo não pode estar em uso por outra conta (409).
- **Auditoria:** `user_updated`, `user_archived`, `user_deleted` (com
  `target_user_id`, que fica apontando para o id apagado; a coluna não tem chave
  estrangeira), `client_updated`, `client_archived`, `client_deleted`.
- **Confirmação na tela em dois cliques no mesmo botão**, sem `confirm()` do
  navegador, que trava os testes automatizados.

## Fase 1: backend com testes (detalhada)

Fluxo do workspace: teste em `tests/backend.php` primeiro, rodar e guardar a
falha, depois o código. Não alterar as contagens existentes da suíte.

### Task 1.1: colunas `archived` e listas

- **Arquivos:** `src/App.php` (mapa `$added`, `listUsers`, `bootstrap`,
  `createTicket`), `database/schema.mysql.sql`, `tests/backend.php`.
- **Contrato:** `GET /api/users` deixa de devolver arquivados e ganha
  `has_history`. `bootstrap` devolve só empresas não arquivadas e, para atendente
  e supervisor, cada empresa ganha `login_email` (ou nulo) e `has_history`.
  `POST /api/tickets` com empresa arquivada responde 422.
- **Testes vermelhos:** banco antigo ganha `archived=0` após `initialize()` duas
  vezes; arquivado não aparece em `/api/users` nem em `bootstrap`; `has_history`
  verdadeiro para atendente do seed e falso para conta recém-criada.

### Task 1.2: editar usuário

- **Rota:** `PATCH /api/users/{id}` com `name`, `email` e, só para o gestor,
  `team_id`. Campos ausentes ficam como estão. Resposta igual à de criar.
- **Testes vermelhos:** matriz de permissão; e-mail de outra conta dá 409 e o
  próprio e-mail é aceito; troca de equipe que esvazia a origem dá 409; arquivado
  dá 404; auditoria `user_updated` com alvo.

### Task 1.3: excluir e arquivar usuário

- **Rotas:** `DELETE /api/users/{id}` (409 "Esta conta tem histórico. Use
  arquivar." quando houver) e `POST /api/users/{id}/archive`.
- **Testes vermelhos:** conta nova é apagada e some do banco; conta com histórico
  dá 409 e continua lá; arquivar com histórico preserva atendimentos e o nome
  neles; as duas guardas de desativar valem para as duas rotas; arquivado não
  loga.

### Task 1.4: editar, excluir e arquivar empresa

- **Rotas:** `PATCH /api/clients/{id}` (`name`, `city`, `state`, `email`),
  `DELETE /api/clients/{id}`, `POST /api/clients/{id}/archive`.
- **Testes vermelhos:** nome repetido de outra empresa dá 409, o próprio é aceito;
  editar e-mail troca o login, que passa a entrar com o e-mail novo; empresa sem
  login dá 422 ao receber e-mail; atendente edita mas recebe 403 ao excluir
  e arquivar; excluir sem histórico apaga empresa e login; com histórico, 409;
  arquivar com atendimento aberto dá 409; arquivar sem aberto arquiva empresa e
  login, e o login deixa de entrar.

### Task 1.5: seed com login para todas as empresas

- **Arquivos:** `src/App.php` (lista `$users` do seed), `tests/backend.php`
  (contagens de 9 para 13, inclusive `tests/backend.php:34` e `:657`).
- **Teste vermelho:** banco novo tem 13 usuários e cada uma das 6 empresas tem
  exatamente um login `client`; `patricia@cti.demo` entra e só vê a Clinica Vida
  Plena.

## Fase 2: telas (detalhada)

Por decisão do Saker, as fases 1 e 2 vão na mesma rodada.

### Task 2.1: Equipe e Supervisores

Em `public/app.js:329-341` e no tratamento de ações (`public/app.js:986` e
`:1023`): cada linha ganha "Editar", que carrega nome, e-mail e (gestor) equipe no
formulário de cima, troca o título para "Editar ..." e o botão para "Salvar
alterações", com "Cancelar" para voltar ao modo criação. O botão de remoção mostra
"Excluir" ou "Arquivar" conforme `has_history`; o primeiro clique troca o texto
para "Confirmar exclusão" ou "Confirmar arquivamento" por 5 segundos, o segundo
executa. Erros da API aparecem na mesma `inline-error` já usada. A tabela continua
com 4 colunas: as ações dividem a última.

### Task 2.2: remodelar `public/clientes/` e dar ações à lista

Queixa do Saker: a tela parece crua, seca, plana e incompleta, tem estilo
diferente do sistema, e a ordem dos campos incomoda. Decisões:

- **Mesma linguagem visual do sistema principal:** fonte Inter de
  `public/assets/`, cores, cartões com sombra, botões e campos copiados dos
  tokens de `public/styles.css`. Continua um app separado com `clientes.css`
  próprio, sem importar o CSS do sistema inteiro.
- **Ordem do formulário:** nome da empresa; e-mail de acesso; cidade e UF na
  mesma linha.
- **Lista vira cartões por empresa**, com nome, cidade e UF, e-mail de acesso (ou
  "Sem acesso à plataforma") e as ações: "Editar" para atendente e supervisor;
  "Excluir" ou "Arquivar" só para supervisor, com o mesmo duplo clique.
- **Editar usa o próprio formulário de cima**, como na Task 2.1.
- **Estado vazio, carregando e erro** com o mesmo cuidado visual, para a tela não
  parecer incompleta.

Testes em `tests/browser.mjs` (Equipe e Supervisores) e `tests/clientes.mjs`
(empresas), cobrindo editar, excluir sem histórico, arquivar com histórico e o
atendente sem os botões de remoção. Conferência visual por captura em 1280px e
390px.

## Fase 3: publicação (épico)

Backup no servidor, deploy pela `main` com o comando de `docs/estado-atual.md`,
conferência pelo endereço da Vercel e atualização de `docs/estado-atual.md`.

## Situação em 13/11/2026

Fases 1 e 2 implementadas na mesma rodada, sem commit e sem deploy. Cada task da
fase 1 teve o teste vermelho rodado antes do código.

Desvios e decisões tomadas na implementação:

- **Reativar conta arquivada responde 404.** Sem isso, `POST
  /api/users/{id}/reactivate` devolvia `active=1` a uma conta arquivada, que
  voltava a entrar. O filtro `archived=0` entrou em `setUserActive`.
- **O INSERT de empresas do seed passou a nomear as colunas**, porque a coluna
  `archived` em `clients` quebraria o INSERT posicional.
- **Excluir e arquivar usuário usam a guarda de supervisor exatamente como
  desativar**, mesmo quando o alvo já está inativo. A mensagem do atendente com
  atendimento aberto diz "antes de excluir" ou "antes de arquivar".
- **Arquivar empresa grava também `user_archived` para o login**, e excluir grava
  `user_deleted`, no mesmo padrão do cadastro (`client_created` mais
  `user_created`).
- **Na edição de empresa sem login, o campo de e-mail fica travado na tela**, com
  o aviso "Esta empresa não tem acesso à plataforma."
- **Testes existentes alterados:** contagem de usuários de 9 para 13
  (`tests/backend.php:34` e `:657`), a lista de chaves de `GET /api/users` ganhou
  `has_history`, e o atendente criado no bloco U trocou `joao@cti.demo` por
  `joao.lima@cti.demo`, porque o e-mail passou a ser do seed.

Testes ao fim: `tests/backend.php` com 494 de 494; `tests/analysis.php` com 43
de 43; `tests/http.mjs` com 30 de 30. `tests/browser.mjs` rodou três vezes,
cada uma com banco e storage novos e isolados, e deu 281 de 282 nas três; a
única falha é a já conhecida do login ("Login sem textos de projeto academico
no rodape"). `tests/clientes.mjs` com 34 de 34 no mesmo servidor da terceira
rodada.

O histórico do atendente que o `tests/browser.mjs` arquiva é criado por uma
sessão separada no próprio Node, com cookie e CSRF próprios. Trocar a sessão da
aba do navegador corria contra as consultas automáticas da tela principal.

Pendente: a fase 3.

Revisão independente em duas rodadas. A primeira achou um defeito de tela:
depois de desativar ou reativar, a linha perdia `has_history` e passava a oferecer
"Excluir" para conta com histórico, que respondia 409. Corrigido em
`public/app.js` juntando a resposta à linha existente, com teste novo em
`tests/browser.mjs` que falhou antes e passou depois (282 de 283, só a falha
conhecida do login). A segunda rodada passou sem achados. Abaixo do portão e
registrado para quando o MySQL entrar: `database/schema.mysql.sql` declara chave
estrangeira em `audit_events.target_user_id`, o que impediria excluir usuário
naquele banco.
