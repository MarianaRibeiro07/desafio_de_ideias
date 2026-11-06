# Estado atual do MVP (6 de novembro de 2026)

Onde paramos: o MVP está funcional e testado. Os feedbacks recebidos até aqui foram aplicados.

## Feito nesta etapa

- Perfis e alertas: gestor sem alertas, supervisor só crítico e "não resolveu", atendente só prazo e "não resolveu".
- Cliente decide por botões ("Resolveu" ou "Ainda preciso de ajuda") depois de ler a solução.
- Prioridade no registro (baixa 8h, média 4h, alta 1h, crítica 30min). O servidor calcula o prazo.
- Níveis de suporte N1 a N3, com ação "Escalar" para o supervisor.
- Cidade e UF no cadastro do cliente.
- Cadastro de clientes em tela separada (`/clientes/`) para atendente e supervisor. A aba Clientes do sistema geral é só consulta.
- Concordância IA x humano removida.
- Gestor com tema de painel executivo (claro por padrão, botão para o escuro), gráficos variados e evolução no tempo refeita.
- Tabelas com no máximo 4 colunas e `<details>` para o resto.
- Comando `php bin/console.php backup` e sugestão de rotina em `docs/operacao.md`.

## Como verificar

- `php tests/backend.php` (374), `php tests/analysis.php` (43).
- Com servidor no ar e `CTI_BASE_URL` definido: `node tests/http.mjs` (30), `node tests/browser.mjs` (232), `node tests/clientes.mjs` (13).

## Pendências

- Figma desatualizado: refazer as telas a partir do app (limite de chamadas do plano esgotado) e apagar as 22 antigas.
- Adaptador MySQL (o schema existe, o adaptador não).
- Equipes, vocabulário e dados reais da CTI (perguntar à empresa).
- Upload de chamadas longas (MP3 e WAV).
- Lista de clientes sem data de cadastro (a tabela não guarda o campo).
- Fixo de 8 dígitos sem DDD não é mascarado; mensagens do atendente não passam pela máscara.
- Não conferido: telas do atendente e do supervisor em 390px por captura (só por checagens automáticas), hover com mouse real, `prefers-reduced-motion`.
- Atendimentos antigos migrados ficam como prioridade média e N1.
