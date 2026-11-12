# Escalabilidade: do MVP ao volume real

Este documento responde a pergunta "e quando houver milhares de registros?". A resposta curta: o layout comporta o crescimento, o que precisa mudar é como os dados chegam à tela. O MVP carrega tudo de uma vez, o que é adequado para a demonstração e para cerca de mil atendimentos. Acima disso, o caminho é conhecido, está dividido em degraus com gatilho de decisão e não exige refazer telas nem banco.

## Onde o MVP está hoje

Os números abaixo foram medidos, não estimados. O banco de demonstração (21 tickets) foi copiado e replicado até o volume indicado, e a API foi chamada em PHP com a sessão de cada perfil. A coluna do navegador foi medida no Chromium via Playwright, em localhost, com 5.000 tickets. O procedimento está em [Como repetir a medição](#como-repetir-a-medição).

| Tickets no total | Gestor: bootstrap | Supervisor: bootstrap | Atendente: bootstrap | Relatório (gestor) | Pico de memória PHP |
|---|---|---|---|---|---|
| 100 | 13 ms, 0,17 MB | 9 ms, 0,10 MB | 7 ms, 0,04 MB | 4 ms | 4 MB |
| 1.000 | 72 ms, 1,6 MB | 42 ms, 0,84 MB | 18 ms, 0,36 MB | 22 ms | 14 MB |
| 5.000 | 383 ms, 8,1 MB | 213 ms, 4,2 MB | 85 ms, 1,8 MB | 117 ms | 64 MB |
| 10.000 | 1.647 ms, 16,2 MB | 491 ms, 8,4 MB | 292 ms, 3,5 MB | 413 ms | 124 MB |

No navegador, com 5.000 tickets no total:

| Medida | Resultado |
|---|---|
| Login até a tela pronta (atendente e gestor) | 2,3 s |
| Troca de tela | 2,0 s |
| Linhas desenhadas na tela do atendente | 1.192 |
| Nós de DOM e altura da página do atendente | 33.487 nós, 153.907 px |

Leitura: o servidor aguenta bem mais do que se temia (1,6 s no pior caso medido). O custo que cresce rápido é o que o navegador baixa e desenha a cada carga e a cada troca de tela. O pico de memória a 10.000 tickets (124 MB) também importa: se a hospedagem limitar o PHP a 128 MB, esse volume já estoura. O limite da hospedagem escolhida precisa ser conferido antes de crescer (não foi verificado).

O que não foi medido: o navegador abaixo de 5.000 tickets (a 1.000 espera-se algo proporcional, perto de meio segundo, mas é extrapolação), dispositivo móvel, rede real entre cliente e servidor e usuários simultâneos.

## O que limita e o que não limita

**Não limita: o layout.** A tabela de quatro colunas, os cards, o menu lateral recolhível, a zebra e os gráficos agregados funcionam com qualquer volume, desde que recebam uma página de dados por vez. Os gráficos já são agregados (sentimento, tendência por dia, prioridade, níveis) e não crescem com o número de linhas.

**Limita: três decisões de carga.**

1. **Carga integral.** `GET /api/bootstrap` (`src/App.php:305`) devolve todos os tickets, os feedbacks e as respostas do escopo do usuário, sem `LIMIT`, e consulta as respostas ticket a ticket (`App.php:307`). Cada ação que altera dados chama `refreshData()` (`public/app.js:82`) e baixa tudo de novo.
2. **Desenho integral.** As listas desenham todas as linhas (`public/app.js:234`, `:290`, `:318`) e o `render()` refaz o HTML do app inteiro a cada filtro ou troca de tela. Os filtros e as somas dos painéis do supervisor rodam no navegador sobre a lista completa: `state.data.tickets` é usado em 17 pontos e `state.data.feedbacks` em 11.
3. **Agregação em PHP.** `report()` (`App.php:610`) carrega todas as linhas filtradas para arrays e soma em laço. Funciona até dezenas de milhares de linhas, mas a memória cresce junto com o volume (124 MB a 10.000).

Dois itens menores acompanham: os lembretes crescem sem teto (um por feedback crítico sem revisão do supervisor), e a rotina de manutenção roda dentro do bootstrap (`App.php:306`).

## O caminho em degraus

Cada degrau tem um gatilho. Enquanto o gatilho não ocorrer, o degrau seguinte não é necessário. Os degraus 1 e 2 são independentes de troca de banco.

### Degrau 0: demonstração (agora)

Tudo carregado de uma vez. Vale até cerca de 1.000 tickets no total (gestor: 1,6 MB e 72 ms no servidor). Nenhuma mudança necessária para o pitch.

### Degrau 1: listas paginadas no servidor

**Gatilho:** mais de 1.000 tickets no total, ou qualquer perfil com mais de 200 linhas na tela, ou troca de tela acima de 1 s.

**Decisões:**

- Duas rotas novas de leitura, `GET /api/tickets` e `GET /api/feedbacks`, com os filtros que hoje rodam no navegador (período, status, equipe, atendente, cliente, sentimento, criticidade, texto), ordenação por `id` decrescente e paginação por cursor (`before_id`), 50 itens por página. A resposta traz `items`, `total` e `next_before_id`. O escopo por perfil continua em `App::scope()`.
- `GET /api/tickets/{id}` devolve o ticket com as respostas. As respostas saem do bootstrap e são buscadas ao abrir "Mais detalhes", o que elimina uma consulta por ticket.
- O bootstrap passa a trazer apenas usuário, equipes, categorias, contagens por status e os 20 lembretes mais urgentes com o total.
- Clientes: a lista de seleção passa a buscar por nome no servidor (`GET /api/clients?q=`), com limite de resultados.
- Tela: rodapé de tabela "1 a 50 de N" com Anterior e Próxima, e a linha padrão fica mais compacta (hoje ocupa cerca de 130 px, com resumo e "Mais detalhes").

**Impacto:** `src/App.php` (bootstrap, rotas novas, `ticketSelect`, `feedbackSelect`) e `public/app.js` (os 28 pontos que leem as listas completas, `refreshData` e os componentes de tabela). Os testes de `tests/backend.php` e `tests/browser.mjs` que dependem do bootstrap completo precisam ser ajustados.

**Critério de pronto:** com 10.000 tickets, o login e a troca de tela terminam em menos de 1 s no navegador, e a página nunca desenha mais de 50 linhas por tabela.

### Degrau 2: agregação e índices no banco

**Gatilho:** relatório acima de 300 ms, ou acima de 5.000 tickets, ou memória do PHP acima de 64 MB.

**Decisões:**

- Os painéis do supervisor e do gestor que ainda somam no navegador (prioridade, níveis, prazos, equipes) passam a vir de consultas `GROUP BY` na rota de relatório, e `report()` deixa de carregar linhas para somar em PHP. A tabela "Casos para tratar" continua vindo da lista paginada.
- Os filtros de data trocam `substr(created_at,1,10) >= ?` (`App.php:620`) por comparação direta de intervalo (`created_at >= ? AND created_at < ?`), para o índice ser usado.
- Índices novos a medir antes de criar: `tickets(created_at)` e um índice composto por escopo e data. Hoje existem `tickets_scope_idx`, `tickets_deadline_idx`, `feedbacks_filters_idx` e `feedbacks_analysis_idx`.
- A busca textual por assunto (`LIKE '%texto%'`) varre a tabela. Se ficar lenta, trocar por busca por prefixo ou por índice de texto completo (FTS5 no SQLite, `FULLTEXT` no MySQL).
- A manutenção (fechamento por prazo, retenção de 12 meses) sai do bootstrap e roda por `php bin/console.php maintenance` agendado (cron na hospedagem). O comando já existe.

**Critério de pronto:** `/api/reports` com 10.000 tickets abaixo de 150 ms e pico de memória abaixo de 32 MB.

### Degrau 3: banco MySQL ou MariaDB

**Gatilho:** mais de cerca de 20 usuários gravando ao mesmo tempo, ou mais de 50.000 tickets, ou exigência da CTI de usar o banco corporativo. SQLite com um servidor PHP atende o MVP, mas serializa as escritas e vive em um arquivo só.

**Decisões:**

- O modelo equivalente já existe em `database/schema.mysql.sql`. Falta o adaptador PHP, e é a pendência já registrada em [estado atual](estado-atual.md).
- Pontos conhecidos que dependem do SQLite e precisam de equivalente: `PRAGMA foreign_keys` e `busy_timeout` na abertura (`App.php:31`) e `VACUUM INTO` no backup (`App.php:559`). O levantamento completo das consultas específicas de dialeto é a primeira tarefa do degrau.
- Fazer depois do Degrau 1, porque consultas paginadas e agregadas são as que o MySQL executa bem. Trocar de banco com a carga integral só muda o lugar do gargalo.

**Critério de pronto:** a suíte de testes de backend roda contra MySQL e SQLite com o mesmo resultado.

### Degrau 4: processamento fora da requisição

**Gatilho:** análise de IA com fila longa, ou mais de uma instalação.

A análise de feedback já tem fila e worker (`analysis:work`, [arquitetura](arquitetura.md)). O que falta é ligá-lo a um agendador permanente, o que depende da hospedagem: o plano gratuito atual não aceita processo persistente, e por isso a demonstração processa um feedback por requisição.

## O que a CTI precisa informar

Estes dados decidem em que degrau o produto precisa estar no lançamento. Não existem no repositório.

- Quantos atendimentos por mês a CTI espera registrar nos primeiros 12 meses.
- Quantas pessoas usam o sistema ao mesmo tempo no horário de pico.
- Se a CTI hospeda o banco ou aceita uma hospedagem externa.

Com 1.000 atendimentos por mês, o Degrau 1 passa a ser necessário depois do primeiro mês.

## Para a apresentação

**Slide sugerido, título: "Pronto para crescer".**

Uma tabela de três linhas, com a conclusão em uma frase embaixo:

| Hoje (MVP) | Próximo passo | Escala |
|---|---|---|
| Até ~1.000 atendimentos, tudo carregado de uma vez | Listas paginadas e indicadores calculados no banco | MySQL, tarefas agendadas e vários usuários simultâneos |
| Medido: 72 ms e 1,6 MB para o gestor | Meta: tela em menos de 1 s com 10.000 | Meta: 50.000 atendimentos |

Frase de fechamento: "O layout já comporta o crescimento. O que muda é como os dados chegam à tela, e esse caminho está medido e planejado."

**Pergunta provável da banca: "Isso aguenta a empresa inteira?"**

Resposta de 20 segundos: "Hoje o sistema foi medido com até 10.000 atendimentos de teste. O servidor responde em menos de 2 segundos mesmo assim, mas o navegador demora, porque a tela baixa tudo. Sabemos exatamente onde mexer: paginar as listas e calcular os indicadores no banco. Isso não exige trocar as telas. Falta só a CTI nos dizer o volume real para escolhermos o ponto de partida."

Este slide só deve ser apresentado como plano. Os degraus 1 a 4 não estão implementados.

## Como repetir a medição

1. `php bin/console.php init` para garantir o banco de demonstração.
2. `php bin/medir-volume.php 1000` (troque 1000 pelo volume). O script copia o banco para uma pasta temporária, replica tickets e feedbacks até o total pedido e imprime tempo, tamanho e memória das rotas `/api/bootstrap` e `/api/reports` para gestor, supervisor e atendente. O banco real não é alterado.
3. Os tempos variam entre execuções em dezenas de milissegundos. O tamanho em MB e as contagens são estáveis.

A medição de navegador usou um servidor PHP apontando `CTI_STORAGE_PATH` para a cópia inflada, o login do atendente e do gestor, e a leitura de `performance.now()` até o primeiro quadro desenhado.

Esta medição não representa carga concorrente nem a rede de uma hospedagem real. Repita-a no ambiente publicado antes de afirmar números para a CTI.
