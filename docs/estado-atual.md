# Estado atual do MVP

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
- A lista do supervisor mostra "Áudio gravado" também para áudio anexado; o
  servidor não guarda a diferença.
- O player do áudio na revisão mostra duração `Infinity` e não exibe o tempo
  total, embora reproduza o arquivo completo. Causa não verificada; suspeita de
  falta de `Content-Length` ou suporte a `Range` na rota de áudio.
- O painel de gravação ainda diz que o áudio é analisado "neste computador".
- O teste `Login sem textos de projeto academico no rodape` em
  `tests/browser.mjs` falha desde o commit `f138e99`, que mudou os textos do
  login.
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
