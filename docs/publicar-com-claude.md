# Publicar o CTI Escuta com Claude Code e Claude in Chrome

## Como iniciar

Este prompt foi escrito para o Claude Code conectado à extensão Claude in Chrome.
O Code lê os arquivos e usa o terminal; a extensão configura os painéis e verifica
o site no navegador. Abra o Chrome com a extensão conectada e execute no PowerShell:

```powershell
Set-Location -LiteralPath 'C:\Users\fbrec\Documents\Claude\projects\CTI-desafio-de-ideias'
claude --chrome
```

No Claude Code, use `/chrome` para conferir a conexão. Depois, envie:

> Leia docs/publicar-com-claude.md e execute o brief abaixo até publicar e validar a demonstração. Já autorizo a configuração gratuita, o envio dos arquivos e duas chamadas reais de aceitação ao Gemini. Intervenha nas minhas contas somente dentro desse escopo.

Se preferir a extensão do Claude Code no editor, abra a mesma pasta e confira a
integração com Chrome antes de enviar a instrução. Somente o painel lateral do
Chrome não oferece, por si só, o acesso local e o terminal usados neste roteiro.

Fonte da integração e dos comandos: [documentação oficial](https://code.claude.com/docs/en/chrome).

## Brief para o agente executor

### Resultado esperado

Publique o CTI Escuta numa conta Alwaysdata Free dedicada à demonstração acadêmica,
acessível por URL HTTPS em outra máquina, com PHP, SQLite e Gemini
`gemini-3.5-flash-lite` por API. Execute uma análise real de texto e uma de áudio
curto e preserve os resultados para o pitch.

Faça o trabalho, em vez de apenas devolver outro tutorial. Prossiga sem me pedir
aprovação para escolhas técnicas rotineiras já cobertas por este brief. Login,
CAPTCHA, permissões da extensão e pagamento podem exigir minha intervenção.

### Contexto obrigatório

- Workspace: `C:\Users\fbrec\Documents\Claude`.
- Projeto: `C:\Users\fbrec\Documents\Claude\projects\CTI-desafio-de-ideias`.
- Guia principal: [docs/hospedagem.md](hospedagem.md), dentro do projeto.
- Estado e plano: `docs/estado-atual.md` e `docs/plano-demo-hospedada.md`.
- O repositório remoto é `MarianaRibeiro07/desafio_de_ideias`.
- A entrega foi integrada à `main`, que é a origem do deploy. Confira o estado
  atual antes de agir.
- Preserve eventuais alterações locais. Não descarte mudanças para deixar o Git
  limpo.
- Ainda não foi comprovada a criação das contas Alwaysdata e Google AI Studio.
  Primeiro descubra o estado pelas sessões autorizadas do navegador.
- A implementação passou em testes locais com respostas simuladas. Isso não prova
  que já esteja publicada ou que uma chave real seja aceita.

Leia as instruções aplicáveis do workspace e do projeto. Respeite a regra dos
três arquivos e a delegação quando aplicável. Todo texto produzido deve estar em
português do Brasil, com acentuação, sem os caracteres U+2014, U+2013 e U+2212.

### Ferramentas e navegador

1. Confira se dispõe de leitura e escrita locais, terminal e ferramentas reais da
   integração Claude in Chrome. Use a descoberta disponível; não invente nomes
   de ferramentas nem flags.
2. Consulte o contexto das abas antes de navegar. Abra abas de trabalho próprias,
   sem tomar uma aba pessoal não indicada pelo usuário.
3. Use Chrome para os painéis autenticados e a validação visual. Use terminal,
   SSH e transferência de arquivos para publicar. Não tente simular comandos de
   sistema com JavaScript de uma página nem mover arquivos por texto colado no
   console do navegador.
4. Se faltarem ferramentas locais, explique a limitação e peça que eu abra o
   Claude Code na pasta indicada. Não declare que apenas a extensão consegue
   concluir o upload local e a configuração do servidor.
5. Não burle permissões de site, CAPTCHA ou bloqueios da extensão. Peça minha
   intervenção pontual e retome do ponto em que parou, preservando o progresso.

### Autorização e limites

Está autorizado:

- Criar e configurar os recursos gratuitos dedicados ao CTI, usando dados que eu
  forneça ou confirme na interface, sem inventar informações pessoais.
- Configurar site PHP, raiz pública, HTTPS, acesso remoto, caminhos privados e
  extensões necessárias na conta dedicada.
- Enviar o código local, executar preflight e inicializar a base sintética.
- Usar a chave do projeto Gemini somente para o CTI e realizar as duas chamadas
  reais descritas abaixo, depois das verificações sem consumo.
- Fazer correções pequenas comprovadamente necessárias à publicação, com teste
  adequado e registro do que mudou. Decisões de arquitetura fora do brief exigem
  voltar ao usuário com o conflito concreto.

Não está autorizado:

- Fazer compras, cadastrar cartão, concluir pagamento, assinar plano pago ou
  ativar recarga automática. Se crédito for necessário, prepare a tela revisável,
  mostre valor e moeda e me deixe concluir a compra. Continue o trabalho gratuito
  que não dependa disso.
- Alterar outros sites, contas ou projetos existentes, apagar banco ou gravações,
  aumentar o teto de 20 tentativas sem minha autorização, fazer commit ou push.
- Reescrever o backend, migrar banco ou implantar modelos locais como parte da
  hospedagem deste MVP.

Um orçamento de aproximadamente R$ 30 foi discutido, mas isso não autoriza uma
cobrança. O mínimo de US$ 5 era uma referência consultada em 11/11/2026; confira o
checkout atual, incluindo encargos. Pré-pago e recarga desligada são a preferência.

### Segredos e acesso

- Senhas, códigos de login e confirmação por e-mail são tratados na interface,
  com minha intervenção quando necessária. Não peça que eu cole esses dados no
  chat, nem acesse arquivos de credenciais do Claude ou de outros programas.
- A chave Gemini não pode aparecer em resposta, captura, gravação, comando salvo
  no histórico, arquivo versionado ou pasta pública.
- Use o mecanismo seguro disponível para inserir a chave no arquivo privado.
  Se isso exigir expor o segredo na saída das ferramentas, peça que eu mesmo o
  insira no arquivo ou campo apropriado e continue depois. Não improvise um canal
  público para transportar a chave.
- SSH precisa ser autenticado por um método permitido e sem senha embutida em
  argumentos. Confira a identidade do servidor pelas informações do painel.
- Não grave GIF nem faça captura enquanto chave, senha ou pagamento estiverem
  visíveis. Evidências da configuração devem ocultar os valores secretos.

### Execução, na ordem

#### 1. Descobrir o estado atual

Leia o guia e confira Git, arquivos locais e sessões do navegador. Identifique a
conta de hospedagem e o projeto Google corretos. Se eu precisar entrar, informe
somente em qual página e o que precisa ser feito. Não comece o cadastro de outro
recurso quando já existir um recurso dedicado que resolva a etapa.

#### 2. Configurar os painéis

No Alwaysdata, escolha o Free dedicado ao CTI. No Google AI Studio, selecione ou
crie o projeto e a chave correspondentes. Não envie prompts no playground.
Configure acesso remoto, PHP 8.4, site e diretivas conforme o guia e as opções
reais do painel. Verifique os rótulos antes de clicar.

#### 3. Publicar a versão local

Use os diretórios `src`, `database`, `bin` e `public` da pasta local, incluindo
`src/GeminiAnalyzer.php`, `bin/preflight.php` e `public/.htaccess`.

- Raiz pública: `/home/CONTA/cti/public`.
- Configuração privada: `/home/CONTA/private/cti-env.php`.
- Banco e áudios: `/home/CONTA/private/cti-storage`.
- Provider: `CTI_ANALYSIS_PROVIDER=gemini`.
- Modelo: `CTI_GEMINI_MODEL=gemini-3.5-flash-lite`.
- Teto: `CTI_GEMINI_MAX_REQUESTS=20`.
- Timeout: `CTI_GEMINI_TIMEOUT=40`.

Substitua CONTA pelo nome observado. Não publique a raiz do repositório, não
envie a chave ao Git e não inicie `analysis:work` nem instalação de modelos Node.
Preserve bases existentes. Antes de uma atualização que as afete, faça uma cópia
privada com o mecanismo de backup existente e confira o resultado.

#### 4. Validar sem usar Gemini

Execute o preflight com a configuração privada, depois inicialize o banco se a
instalação ainda precisar disso. Confira HTTP/HTTPS, login dos quatro perfis,
assets, rotas, permissões e bloqueio de arquivos privados. O guia especifica
caminhos que devem retornar 404. Consulte o contador de reservas e anote o valor.

Os testes automatizados devem usar transporte simulado e uma base temporária
isolada, sem herdar chave real nem executar análise no servidor publicado.
Não repita a suíte inteira que já passou sem mudança ou falha que justifique.

#### 5. Fazer somente duas chamadas reais

Prepare dois atendimentos distintos da empresa `Grupo Aurora Logistica`, já
vinculada ao cliente de demonstração Lucas. Use o roteiro exato do guia:

- Rafael, `rafael@cti.demo`, registra os casos e envia as soluções.
- Lucas, `lucas@cti.demo`, envia um texto e um áudio de 10 a 15 segundos.
- Marina, `marina@cti.demo`, confere os resultados completos na supervisão.
- Helena, `helena@cti.demo`, consulta os indicadores de gestão.
- Senha das contas sintéticas: `CtiDemo2026!`.

O envio de texto ou áudio já dispara análise. Não chame a rota de análise,
clique em analisar ou acione retry adicional só para conferir o mesmo resultado.
Gravação e reprodução da prévia não usam Gemini; enviar o feedback usa.

Se precisar da minha voz ou de permissão do microfone, peça uma intervenção
pontual. Não apresente áudio simulado como validação do microfone físico. Uma
amostra fictícia previamente gravada pode validar o pipeline, desde que seja
identificada e compatível com o fluxo real de entrada disponível.

Confira transcrição, origem Gemini, resumo e persistência, sem inventar score
de confiança nem forçar um resultado emocional específico. Reabra os resultados
e compare o contador: consultas a resultados concluídos não devem reservar novas
chamadas. Guarde os tempos e protocolos sem dados pessoais reais.

O limite é de duas solicitações reais iniciais, inclusive se falharem. Se alguma
falhar, investigue a causa com logs sanitizados e testes sem rede. Antes de uma
terceira solicitação, apresente o diagnóstico e peça minha autorização.

#### 6. Fechar a publicação

Deixe os dois resultados reais disponíveis como reserva do pitch e confira a
explicação do limite de 60 segundos. Documente URL, caminhos efetivos, etapas
concluídas, chamadas reais usadas e pendências em `docs/estado-atual.md`, sem
segredos. Atualize o plano se uma fase tiver sido realmente concluída. Não marque
a entrega completa enquanto publicação e inferência real não tiverem evidência.

### Tratamento de bloqueios

Uma ação falhando três vezes exige parar esse caminho e registrar tentativas,
retornos e diagnóstico. Não repita envios, cadastros ou pagamentos sem conferir
se o anterior concluiu. Permissão negada ou extensão desconectada exige resolver
o acesso, não contornar a restrição com outra ferramenta.

Quando pedir minha intervenção, diga o passo exato que falta e o que já ficou
pronto. Evite transformar um bloqueio de login em uma lista de tarefas que você
próprio consegue executar após eu entrar.

### Evidência e resposta final

Na raiz do projeto, use o comando abaixo para arquivos versionados:

```sh
LC_ALL=C.UTF-8 git grep -nP '[\x{2014}\x{2013}\x{2212}]' -- '*.md' '*.php' '*.js' '*.mjs' '*.html' '*.ps1'
```

Ao editar arquivos, execute a varredura exigida pelas regras do workspace com
`LC_ALL=C.UTF-8`. Dentro do projeto, use `git grep -nP` para versionados; para
novos ainda sem rastreamento, use também `grep -nP` nos arquivos exatos. Procure
os códigos `\x{2014}`, `\x{2013}` e `\x{2212}` e confira o exit code: 1 limpo,
0 encontrou ocorrência, 2 erro. Confira cada comando separadamente e não declare
limpeza só por tela vazia.

Entregue em português:

- **Feito:** URL pública e o que foi configurado.
- **Evidência:** comandos, respostas HTTP, resultado dos dois casos, tempos e
  contador antes/depois. Distinga testes simulados de inferência real.
- **Não verificado:** qualquer etapa sem comprovação e o bloqueio concreto.
- **Consumo:** quantas chamadas reais Gemini foram feitas, incluindo falhas;
  informe se houve ou não pagamento, sem expor dados financeiros.

## Limites desta instrução

Este arquivo é um brief de execução. Ele não criou contas, publicou o sistema,
testou a conexão do seu Claude com Chrome ou autorizou pagamento. A disponibilidade
real depende das ferramentas, permissões, sessões autenticadas e recursos da conta.
