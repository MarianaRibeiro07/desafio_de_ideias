# Estado atual do MVP

## Atualização de 11 de novembro de 2026: demonstração hospedada

O escopo foi ajustado para pitch por URL pública. A integração Gemini 3.5
Flash-Lite foi implementada para processamento sob demanda, por feedback. O teto
inicial é de 20 tentativas por instalação, com reserva atômica antes da chamada,
sem repetição automática após falha e sem nova chamada ao reabrir um resultado
concluído. A análise preserva a revisão humana e registra confiança nula para
Gemini. A hospedagem proposta é Alwaysdata Free, preservando PHP e SQLite.

Consulte o [plano aprovado](plano-demo-hospedada.md), o [guia de publicação em 12
etapas](hospedagem.md) e o [brief de automação com Claude Code e Claude in
Chrome](publicar-com-claude.md). O guia inclui campos dos painéis, comandos por
terminal, resultados esperados e consulta ao contador sem consumir Gemini.

As contas e as credenciais ainda precisam ser preparadas. Não houve deploy nem
validação com chave real. A aceitação inicial no servidor reserva somente duas
chamadas, incluindo eventuais falhas: um texto e um áudio de 10 a 15 segundos.
Uma terceira solicitação real exige diagnóstico e autorização do usuário.

Na rodada local, 776 verificações passaram: backend 374, análise 43, cliente
Gemini 40, processamento hospedado 40, HTTP 30, navegador geral 232 e navegador
hospedado 17. Os resultados Gemini foram simulados e nenhuma chamada real à API
foi realizada. Também foram conferidos preflight, roteamento Apache e os trechos
de comandos do guia em ambiente temporário. Isso não comprova a hospedagem final.

Permanecem pendentes: criação das contas, configuração privada na hospedagem,
publicação, HTTPS remoto e as duas inferências reais com seus tempos registrados.
Não houve compra de créditos. O brief autoriza configuração gratuita e orienta o
usuário a concluir qualquer pagamento, se necessário.

## Registro da versão local de 6 de novembro de 2026

As afirmações e pendências abaixo pertencem à rodada local daquela data.

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
