# Estado atual do MVP

## Atualização de 13 de novembro de 2026 (fim do dia): editar, excluir e arquivar

Clientes, atendentes e supervisores agora podem ser editados, excluídos e
arquivados, e a tela `/clientes/` foi remodelada. Plano, decisões, desvios e
revisão em [editar, excluir e arquivar](plano-editar-excluir.md). Resumo:

- Exclusão real só para quem nunca participou de atendimento, revisão, resposta
  ou auditoria. Com histórico, o botão vira "Arquivar": a conta ou empresa sai
  das listas, perde o acesso, não volta e mantém o nome nos atendimentos antigos.
- Atendente e supervisor editam empresas; só o supervisor exclui ou arquiva.
  Usuários seguem a matriz de desativar.
- `/clientes/` usa a linguagem visual do sistema, com o formulário na ordem nome,
  e-mail, cidade e UF, e a lista em cartões com as ações.
- O seed dá login às empresas 3 a 6 (`patricia@`, `joao@`, `renata@` e
  `marcos@cti.demo`). O seed só roda em banco vazio: **o banco publicado não
  ganha esses logins** pelo deploy.

Testes em banco novo, nesta data: backend 494 de 494, análise 43 de 43, cliente
Gemini 40 de 40, processamento hospedado 40 de 40, HTTP 30 de 30, clientes 34 de
34 e navegador 282 de 283. A falha era a conhecida do rodapé do login, corrigida logo abaixo.

**Ainda não publicado.** Para publicar: backup no servidor
(`php bin/console.php backup`), o comando de atualização da seção de 13 de
novembro abaixo, e conferência pelo endereço da Vercel. A migração só acrescenta a
coluna `archived` com padrão 0 em `users` e `clients`.

As pendências 1 e 2 da seção seguinte estão resolvidas por esta entrega.

Na mesma data, correções feitas depois da revisão:

- **Sessão de conta excluída.** O SQLite reaproveita o maior `id` apagado em
  `users`, e a sessão guardava só o `id`: a sessão aberta de uma conta excluída
  passava a valer como a conta nova com o mesmo `id`. Agora a sessão guarda uma
  impressão (`sha256` do `id` com o `password_hash`) e `user()` a confere. Efeito
  no deploy: quem estiver logado precisa entrar de novo uma vez.
- Rótulo "Áudio gravado" virou "Áudio"; o painel de gravação não diz mais "neste
  computador"; o teste do rodapé do login deixou de exigir textos removidos de
  propósito no commit `f138e99`.

Testes depois dessas correções, em banco novo: backend 497 de 497, análise 43 de
43, processamento hospedado 40 de 40, HTTP 30 de 30, clientes 34 de 34 e
navegador 283 de 283.

## Atualização de 13 de novembro de 2026 (noite): gestão de usuários publicada

Endereço para o pitch: **https://cti-escuta-proxy.vercel.app**. É um repasse na
Vercel (conta `rbrecci`, configuração em `projects/cti-escuta-proxy/vercel.json`,
fora deste repositório) que encaminha tudo para `ctiescuta.alwaysdata.net`. Ele
existe porque o filtro DNS da rede da escola bloqueia o endereço da Alwaysdata e
deixa passar o da Vercel. Mesmo servidor, mesmo banco e mesma chave Gemini.

Publicado o commit `e33d80a`, com backup anterior em
`~/private/backups/cti-backup-20261113-154623`. A migração preservou os 9
usuários ativos, os dois resultados reais do Gemini e o contador em 2 de 20. Plano
e decisões em [gestão de usuários](plano-gestao-usuarios.md).

O fluxo completo foi testado pelo Saker no endereço da Vercel. Depois disso, a
tela `/clientes/` dava 404 nesse endereço: a regra de repasse não casava caminho
terminado em barra, e `/clientes` sem barra redirecionava para o domínio
bloqueado. A configuração foi corrigida e republicada; `/clientes/` agora
responde 200 pela Vercel. Falta repetir o cadastro de empresa logado por esse
endereço.

### Pendências pedidas pelo Saker, para depois

**1. Editar e excluir clientes, atendentes e supervisores.** Hoje existe só
criar, para os três, e desativar e reativar, para atendentes e supervisores.
Falta:

- Cliente (empresa): editar nome, cidade, UF e o e-mail do login; excluir.
- Atendente: editar nome e e-mail; excluir.
- Supervisor: editar nome, e-mail e equipe; excluir.

Decisão a tomar antes do código: o que "excluir" significa. Usuários e empresas
são referenciados por atendimentos, feedbacks, revisões e auditoria, com chave
estrangeira. Apagar a linha quebraria o histórico ou seria recusado pelo banco.
Opções:

- (a) Excluir só quem nunca teve atendimento; para o resto, a interface oferece
  desativar.
- (b) Excluir vira desativar e some das listas, preservando o histórico.

A inclinação é (a) com o (b) como saída, porque cadastro errado e recém-criado é
o caso real de exclusão.

Regras herdadas que valem também para editar:

- Trocar a equipe de um supervisor não pode deixar a equipe de origem sem
  supervisor ativo.
- O e-mail novo não pode estar em uso.

**2. Mais cuidado com o frontend da tela de cadastro de empresa
(`public/clientes/`).** O escopo ainda não foi definido: falta o Saker apontar o
que incomoda, por exemplo visual, ordem dos campos, mensagens ou o fato de ser
um app separado, com estilo próprio. Precisa ser definido antes de virar task.

## Atualização de 13 de novembro de 2026: publicado e validado com Gemini real

URL pública: https://ctiescuta.alwaysdata.net (Alwaysdata Free, conta `ctiescuta`,
PHP 8.4, SQLite, Force HTTPS). A entrega foi integrada à `main`, que passa a ser
a origem do deploy. O código publicado é o do commit `685e6c7`, idêntico ao da
`main` em `src`, `database`, `bin` e `public`.

Para atualizar a publicação, entre no terminal web do painel (Remote access >
SSH/SFTP > "on the Web") e execute. O comando substitui só o código e preserva
`~/private`, onde ficam chave, banco e áudios:

```sh
rm -rf ~/tmp-cti && git clone -q --depth 1 -b main https://github.com/MarianaRibeiro07/desafio_de_ideias.git ~/tmp-cti && git -C ~/tmp-cti log --oneline -1 && for d in src database bin public; do rm -rf ~/cti/$d && cp -r ~/tmp-cti/$d ~/cti/; done && rm -rf ~/tmp-cti
```

Caminhos efetivos no servidor:

- Código: `/home/ctiescuta/cti` (`src`, `database`, `bin`, `public`).
- Raiz pública do site: `cti/public/`. No painel, a raiz é relativa a
  `/home/ctiescuta/`, e não um caminho absoluto como o guia supunha.
- Configuração privada: `/home/ctiescuta/private/cti-env.php` (permissão 600),
  carregada por `auto_prepend_file` no php.ini do site.
- Banco e áudios: `/home/ctiescuta/private/cti-storage`.

Conferências sem consumo: preflight com 11 `PASS` e saída 0; banco inicializado;
HTTP redireciona para HTTPS (301); certificado válido; `/src/App.php`,
`/database/schema.sqlite.sql`, `/storage/cti.sqlite`, `/.git/config`,
`/router.php` e `/api.php` retornam 404; API sem login retorna 401.

Chamadas reais ao Gemini, ambas da empresa Grupo Aurora Logistica:

| Feedback | Atendimento | Entrada | Tempo | Resultado |
|---|---|---|---|---|
| FDB-2026-0032 | ATD-2026-0043 | texto | até 14 s | negativo, crítico, resumo fiel |
| FDB-2026-0033 | ATD-2026-0044 | áudio anexado de 21 s | cerca de 3 s | transcrição fiel, negativo, crítico |

Contador: 2 de 20 reservas, uma por chamada, sem falhas. Reabrir os dois
resultados quatro vezes e recarregar a página não alterou o contador. Não houve
pagamento; o projeto Gemini segue na faixa gratuita.

Nesta rodada também entrou a opção de **anexar áudio** no feedback do cliente
(commit `a8a623c`). Escrever, gravar e anexar são formas exclusivas, uma por
envio. O anexo é convertido no navegador em WAV mono de 16 bits a 16 kHz e segue
o mesmo caminho da gravação. Teste de navegador local: 239 de 240; a falha
restante é anterior a esta mudança (ver pendências).

Desvios do guia: a rede da escola bloqueia a porta 22, então o código foi
clonado do GitHub direto no servidor e os comandos rodaram no terminal web do
painel. Depois, o filtro DNS da mesma rede passou a desviar `*.alwaysdata.net`
para `146.112.61.110`; a publicação foi concluída pela rede do celular. Para o
pitch, confira antes se a rede do local abre a URL.

Pendências abertas nesta rodada:

- Abrir a URL em outra máquina ou celular e ensaiar o gestor (Helena).
- Feedback marcado como "Resolveu" com conteúdo classificado como crítico pela
  IA encerra o atendimento sem alertar o supervisor. Decidir se a análise deve
  gerar alerta nesse caso.
- O servidor não guarda se o áudio foi gravado ou anexado. A interface passou a
  dizer só "Áudio"; se a diferença importar para a análise, é preciso gravar a
  origem no envio.
- O player do áudio na revisão mostra duração `Infinity` e não exibe o tempo
  total, embora reproduza o arquivo completo. Causa não verificada; suspeita de
  falta de `Content-Length` ou suporte a `Range` na rota de áudio.
- O teste `tests/hosted-browser.mjs` falhou uma vez em quatro com
  `Invalid InterceptionId` e passou nas outras; instabilidade do próprio teste.

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
- Escalabilidade: listas paginadas, indicadores no banco e a rotina de manutenção fora do bootstrap, só quando o volume exigir. Gatilhos e medições em [escalabilidade](escalabilidade.md). Falta a CTI informar o volume esperado.
- Equipes, vocabulário e dados reais da CTI (perguntar à empresa).
- Upload de chamadas longas (MP3 e WAV).
- Lista de clientes sem data de cadastro (a tabela não guarda o campo).
- Fixo de 8 dígitos sem DDD não é mascarado; mensagens do atendente não passam pela máscara.
- Não conferido: telas do atendente e do supervisor em 390px por captura (só por checagens automáticas), hover com mouse real, `prefers-reduced-motion`.
- Atendimentos antigos migrados ficam como prioridade média e N1.
