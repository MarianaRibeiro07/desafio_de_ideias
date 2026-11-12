# MVP hospedado para o pitch

Data: 2026-11-11
Estado: fase 1 concluída com verificação offline; fase 2 depende das contas e credenciais.

## Problema e resultado

A versão local dependia de modelos e de um worker Node iniciado nesta máquina.
O pitch precisa de uma URL acessível em outra máquina, com análise real de um
texto e de um áudio curto. O desenvolvimento deve preservar a cota Gemini.

## Decisões aprovadas

- Hospedagem PHP no Alwaysdata gratuito para demonstração acadêmica.
- Preservar PHP, SQLite, autenticação, perfis e interface existentes.
- Integrar Gemini 3.5 Flash-Lite por HTTPS, com chave exclusivamente no servidor.
- Processar um feedback solicitado por vez, sem serviço permanente.
- Zero chamadas Gemini nos testes automatizados. Validação real inicial limitada
  a duas solicitações no destino, incluindo eventuais falhas: um texto e um áudio
  de 10 a 15 segundos. Uma terceira solicitação exige diagnóstico e autorização
  do usuário.
- Teto global inicial de 20 tentativas por banco de demonstração, configurável por
  `CTI_GEMINI_MAX_REQUESTS`. Falhas também contam, porque timeout não comprova que
  o provedor deixou de processar. Nenhuma repetição automática após falha.
- Reutilizar `audit_events` com evento `gemini_request_reserved`. Reserva e
  reivindicação atômicas; nenhuma transação fica aberta durante HTTP externo.
- Preservar o resultado concluído: nova consulta não gera chamada nem reserva.
- Conservar o backend local como opção de desenvolvimento; a publicação usa
  `CTI_ANALYSIS_PROVIDER=gemini`. A fonte é identificada como `gemini_api`.
- `confidence` fica `NULL` para Gemini. A interface identifica análise por API sem
  inventar porcentagem de acerto e preserva a decisão do supervisor.

## Fora deste trabalho

Chamadas longas, importação MP3, MySQL, integrações de atendimento, treinamento
e dados reais da empresa. O limite de áudio permanece em 60 segundos; o pitch
explica esse recorte e a evolução prevista. Compra de crédito depende de ação
explícita do usuário; não integra a automação autorizada.

## Fundamentação da versão de partida

As referências de linha abaixo registram a versão examinada antes da implementação:

- `src/App.php:210` aplicava CSRF; `:229` roteava ações do feedback; `:296` aplicava escopo.
- `src/AnalysisWorker.php:23` reivindicava jobs; `:41` persistia resultados; `:64`
  executava o motor local. A seleção do menor ID não servia ao disparo de um ID web.
- `public/app.js:909` recebia o feedback criado; `:1009` consultava análises pendentes.
- `public/router.php:4` centralizava rotas e protegia arquivos fora de `public`.
- `database/schema.sqlite.sql:47` possuía a auditoria reutilizada para o teto.

## Contrato

`POST /api/feedbacks/{id}/analyze` exige sessão e CSRF. Cliente da organização,
atendente responsável e supervisor da equipe podem executar. Gestor recebe 403.
Somente `pending` produz chamada; `completed` ou `processing` devolve o estado atual
sem nova reserva. `failed`, `not_required` e conteúdo removido respondem 409.
Provedor local ou configuração ausente respondem 503. Teto esgotado responde 429
e preserva o feedback pendente. Sucesso devolve `data` com o feedback público.

`GET /api/bootstrap` acrescenta `analysis.on_demand` e `remaining_requests`. Nenhuma
chave ou configuração secreta aparece no JSON. O navegador dispara o ID recebido
após enviar feedback ou solicitar retry explícito. Uma retomada da aba só usa
IDs guardados para aquele usuário; não varre o seed nem repete falhas.

## Fase 1: integração testável sem consumo (concluída)

### Épico 1.1: provedor e proteção de consumo

Task 1.1.1: cliente Gemini.

- Contexto: `AnalysisWorker` recebe callable e valida o retorno do motor.
- Implementação: REST `generateContent`, saída estruturada, uma chamada por
  tentativa, timeout até 45 segundos, segredo em header, WAV privado inline.
  Erros de cota, bloqueio, rede ou JSON inválido não produzem análise fictícia.
- Arquivos: `src/GeminiAnalyzer.php` e `tests/gemini.php`.
- Verificação: teste vermelho antes da classe; testes com transporte injetado.
- Pronto quando: requests e respostas válidos, chave protegida e nenhum retry.

Task 1.1.2: rota, reivindicação e teto.

- Contexto: `App` já valida escopo e CSRF; `audit_events` guarda eventos.
- Implementação: rota por ID, injeção de runner para teste, reserva em
  `BEGIN IMMEDIATE`, contador global independente do seed, score `NULL` para Gemini.
  Autorização antecede reserva. Resultado tardio não restaura conteúdo apagado
  nem sobrescreve revisão humana. Liberar sessão antes da espera externa.
- Arquivos: `src/App.php`, `src/AnalysisWorker.php` e `tests/hosted-analysis.php`.
- Verificação: teste vermelho da rota antes da implementação; testes locais de
  autorização, duplicidade, limite e falha; regressão backend e análise.
- Pronto quando: apenas o ID solicitado consome uma reserva e uma chamada simulada.

### Épico 1.2: apresentação e publicação

Task 1.2.1: interface de análise por API.

- Contexto: recibo após envio e atualização incremental já existem.
- Implementação: disparar análise depois de apresentar recibo, guardar IDs em
  `sessionStorage` por usuário, evitar chamadas concorrentes do mesmo navegador,
  limpar retomada após qualquer resposta ou falha. Atualizar análise e indicadores,
  preservando formulários. Identificar Gemini e omitir score `NULL`.
- Arquivos: `public/app.js` e `tests/hosted-browser.mjs`.
- Verificação: estado pendente e concluído com servidor simulado; testes de navegador.
- Pronto quando: envio e retry manual acionam uma vez e polling não consome cota.

Task 1.2.2: pacote de hospedagem.

- Contexto: raiz pública `public`; banco e áudio privados por `CTI_STORAGE_PATH`.
- Implementação: regras Apache reutilizando router, preflight sem rede e guia
  de variáveis privadas, HTTPS, limites e validação de duas chamadas.
- Arquivos: `public/.htaccess`, `bin/preflight.php` e `docs/hospedagem.md`.
- Verificação: sintaxe PHP, preflight com configuração ausente e configurada,
  nenhuma chamada de análise.
- Pronto quando: configuração faltante é detectada sem expor chave ou criar banco.

## Fase 2: publicação e ensaio

**Épico 2.1: conta e publicação.** Criar contas Alwaysdata e Google AI Studio,
inserir o segredo no ambiente privado, conferir SQLite e HTTPS no servidor,
publicar e executar preflight. Saker informou que ainda precisa criar ambas
as contas. A fase será detalhada contra a conta real e suas credenciais.

**Épico 2.2: prova e pitch.** Executar um texto e um áudio curto, registrar duração
e resultado, preparar casos previamente analisados e ensaiar cliente, supervisor
e gestor. O limite inicial é de duas solicitações reais, incluindo falhas.

O [guia de hospedagem](hospedagem.md) traz 12 etapas com painéis, comandos,
conferências e diagnóstico. O [brief para Claude Code e Claude in Chrome](publicar-com-claude.md)
orienta a automação: Chrome opera os painéis, Code lê os arquivos e publica pelo
terminal. Login, CAPTCHA, permissões, microfone e eventual pagamento podem exigir
participação do usuário. Não foi comprovada a conexão dessa integração nesta sessão.

## Critérios de aceite

- [x] Testes simulados sem chave real e sem consumo de API.
- [x] Limite, autorização, duplicidade e preservação de revisão comprovados.
- [x] Interface distingue Gemini e exibe resultados sem recarregar formulário.
- [x] Pacote PHP com raiz pública e segredos privados documentados.
- [x] Guia descritivo e brief de automação preparados.
- [ ] Contas e credenciais disponíveis para a publicação.
- [ ] URL HTTPS acessível em outra máquina.
- [ ] Um texto e um áudio curto analisados no servidor com tempo registrado.

## Evidência da fase 1 e desvios

Em 11/11/2026: backend 374, análise 43, Gemini 40, processamento hospedado 40,
HTTP 30, navegador geral 232 e navegador hospedado 17 verificações aprovadas.
Total: 776, sem chamadas reais Gemini. Preflight com chave fictícia passou e
ocultou o valor; Apache isolado conferiu 14 rotas e bloqueios de arquivos privados.
A varredura dos códigos Unicode proibidos retornou 1, limpa.

Os testes da rota e do navegador falharam antes das implementações, com rota
ausente e disparo automático ausente, respectivamente. O frontend foi corrigido
e a rodada hospedada terminou em 17/17, inclusive 429 sem retry no polling ou
reload. A revisão independente encontrou o botão manual preso após erro de cota;
o caso falhou em 16/17 antes da correção e passou em 17/17 depois. Os resultados
da IA foram simulados nessa rodada.

Não foi criada tabela de consumo: a auditoria existente guarda as reservas.
A documentação do Alwaysdata não comprovou um campo de ambiente PHP no painel;
o guia usa `auto_prepend_file` com arquivo privado. Os comandos do guia foram
conferidos em ambiente temporário, incluindo o contador com e sem banco. Até
essa validação pré-publicação, não houve cadastro, deploy ou compra de créditos.

## Riscos e dependências

Sem contas e chave, a publicação e a inferência real ficam sem verificação. O
plano gratuito e as cotas não garantem disponibilidade no pitch. Crédito pré-pago
reduz a dependência da cota gratuita, mas não elimina falhas do serviço.

A documentação de cobrança consultada em 11/11/2026 informa mínimo de US$ 5,
sujeito ao checkout regional. A PTAX de venda do dia é R$ 5,5606: R$ 27,803 antes
de encargos. A recarga automática deve ficar desligada para limitar o desembolso.
O teto da aplicação não representa um limite monetário para outros aplicativos
que usem a mesma chave ou projeto.

Fontes: [cobrança Gemini](https://aistudio.google.com/docs/billing),
[preços do modelo](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite)
e [PTAX de referência](https://ptax.bcb.gov.br/ptax_internet/consultarUltimaCotacaoDolar.do).
