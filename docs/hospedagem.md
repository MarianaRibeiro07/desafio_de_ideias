# Publicar o CTI Escuta para o pitch, passo a passo

Este roteiro começa na criação das contas e termina com o sistema aberto por uma URL HTTPS em outro computador. A aplicação e o banco ficam no Alwaysdata; o PHP chama o Gemini pela internet. Seu computador não precisa ficar ligado depois da publicação.

Siga as etapas na ordem. Até a etapa 10, nenhuma instrução solicita análise ao Gemini. A etapa 11 faz somente duas chamadas reais: uma de texto e uma de áudio curto.

Para executar este roteiro com um agente, use o [brief do Claude Code com Chrome](publicar-com-claude.md).

## Como acompanhar este guia

Você alternará entre três lugares:

- **Navegador:** painéis do Alwaysdata e do Google AI Studio, além do próprio sistema.
- **PowerShell do Windows:** terminal do seu computador, usado para enviar os arquivos.
- **Terminal SSH:** conexão com o servidor. Depois de executar `ssh`, os comandos digitados naquele terminal passam a rodar no Alwaysdata. `exit` encerra a conexão e volta ao PowerShell.

Os menus seguem a documentação oficial consultada em 11/11/2026. Se o painel estiver traduzido, procure o nome equivalente. As telas da sua conta e a publicação ainda precisam de conferência prática.

**Convenção de nomes:** `CONTA` significa o nome da conta de hospedagem, não seu e-mail. Se o nome for `ctiescutademo`, o diretório será `/home/ctiescutademo` e o endereço será `ctiescutademo.alwaysdata.net`. Esse nome é apenas um exemplo; use o que estiver disponível.

## 1. Criar a conta de hospedagem

**Onde:** navegador, [site do Alwaysdata](https://www.alwaysdata.com/) e [painel administrativo](https://admin.alwaysdata.com/).

1. Faça seu cadastro e conclua a confirmação de e-mail solicitada.
2. No painel, abra **Subscriptions**. Se já houver uma conta de hospedagem, selecione-a. Caso contrário, clique em **Open a new account**.
3. Escolha **Public Cloud** e o plano **Free**.
4. Escolha o nome da conta e anote-o. Ele aparecerá nos caminhos e no subdomínio.
5. Entre na administração dessa conta.

**Conferência:** você deve ter uma conta selecionada e acesso a **Web > Sites**, **Environment > PHP** e **Remote access**. Criar apenas o login por e-mail não substitui criar a conta de hospedagem.

O Free é destinado a uso sem fins lucrativos, limitado ao endereço da conta e sem serviços persistentes. Este roteiro usa uma demonstração acadêmica e processamento por requisição. Fontes: [criação da conta](https://help.alwaysdata.com/en/docs/admin-billing/accounts/create-account/) e [condições do Free](https://help.alwaysdata.com/en/docs/admin-billing/billing/public-cloud-prices/).

## 2. Criar o projeto e a chave do Gemini

**Onde:** navegador, [Google AI Studio](https://aistudio.google.com/).

1. Entre com sua conta Google e aceite os termos apresentados.
2. Abra **Dashboard > Projects** e identifique o projeto do CTI Escuta. Para uma conta nova, o serviço pode criar um projeto e uma chave iniciais.
3. Abra [API Keys](https://aistudio.google.com/apikey). Use a chave do projeto escolhido ou clique em **Create API key** para criar uma nele.
4. Dê um nome reconhecível, como `CTI Escuta Pitch`, quando a tela oferecer esse campo.
5. Guarde a chave para a etapa 6. Ela ficará em um arquivo privado, fora do repositório e da pasta pública. Não a envie pelo chat.

**Conferência:** a página deve listar a chave e o projeto correto. Criar a chave não executa uma análise. Não envie um prompt de teste pelo playground agora, para reservar a cota aos dois testes finais.

Se você já tem projetos Google Cloud e nenhum aparece, use **Dashboard > Projects > Import projects**, selecione o projeto e volte a **API Keys**. Fonte: [gerenciamento de chaves](https://aistudio.google.com/docs/api-key).

### Opcional: adicionar o mínimo de crédito

1. Em [Projects](https://aistudio.google.com/projects), encontre o mesmo projeto da chave e clique em **Set up billing**.
2. Preencha país, dados e forma de pagamento. Se houver escolha, use **Prepay**, o pré-pago.
3. O mínimo geral documentado é US$ 5; confirme o valor regional no checkout antes de pagar. Pela PTAX de 11/11/2026, isso representa R$ 27,80 antes dos encargos e pode ultrapassar R$ 30 no pagamento.
4. Em [Billing](https://aistudio.google.com/billing), deixe **Auto-reload** desligado. Confira se o saldo aparece e o projeto está no plano pago.

Se a tela só oferecer cobrança posterior, não trate isso como pré-pago. Você pode continuar com a faixa gratuita enquanto decide sobre o pagamento. Crédito não elimina limites de requisição nem falhas do serviço. Fontes: [cobrança Gemini](https://aistudio.google.com/docs/billing) e [PTAX de referência](https://ptax.bcb.gov.br/ptax_internet/consultarUltimaCotacaoDolar.do).

## 3. Habilitar e abrir o acesso SSH

**Onde:** primeiro no painel Alwaysdata, depois no PowerShell do Windows.

1. Abra **Remote access > SSH/SFTP**. Algumas páginas da documentação chamam esse menu apenas de **SSH**.
2. Use o usuário padrão, com o nome da conta. Confira se a conexão por senha está permitida e defina a senha desse usuário, se necessário. É a senha SSH; não presuma que seja a senha de login por e-mail no painel.
3. Confira o servidor e a fingerprint, ou impressão digital, nessa tela. O formato documentado do servidor é `ssh-CONTA.alwaysdata.net`, porta 22.
4. Abra o PowerShell no Windows. Execute este bloco e informe o nome real da conta:

~~~powershell
Set-Location -LiteralPath 'C:\Users\fbrec\Documents\Claude\projects\CTI-desafio-de-ideias'
Get-Command ssh, scp
$CtiConta = Read-Host 'Nome da conta Alwaysdata, sem e-mail e sem domínio'
$CtiDestino = "$CtiConta@ssh-$CtiConta.alwaysdata.net"
ssh $CtiDestino
~~~

`Get-Command` deve mostrar `ssh.exe` e `scp.exe`, disponíveis nesta máquina. As variáveis guardam a conta e o destino, não a senha. Mantenha esta janela aberta para reaproveitá-las.

Na primeira conexão, compare a fingerprint com a do painel. Se coincidir, confirme com `yes`. Digite a senha SSH quando solicitada; nenhum caractere aparecerá durante a digitação. Isso é esperado.

**Conferência:** depois do login, execute `pwd`. Para o usuário padrão, o caminho esperado é `/home/CONTA`. Se aparecer `Permission denied`, confira o usuário, a senha SSH e a permissão de conexão por senha. Fontes: [SSH](https://help.alwaysdata.com/en/docs/web-hosting/remote-access/ssh/) e [usuário SSH](https://help.alwaysdata.com/en/docs/web-hosting/remote-access/ssh/create-a-ssh-user/).

## 4. Criar as pastas no servidor

**Onde:** terminal SSH aberto na etapa anterior.

Execute o bloco completo:

~~~sh
mkdir -p "$HOME/cti" "$HOME/private/cti-storage"
chmod 700 "$HOME/private" "$HOME/private/cti-storage"
printf 'Projeto: %s\nConfiguração privada: %s\nBanco e áudios: %s\n' "$HOME/cti" "$HOME/private/cti-env.php" "$HOME/private/cti-storage"
~~~

`mkdir -p` cria as pastas que ainda não existem. `$HOME` já aponta para a pasta da conta no servidor. `chmod 700` restringe o acesso às pastas privadas ao usuário da conta.

Anote os três caminhos impressos. A organização será:

~~~text
/home/CONTA/
  cti/
    bin/
    database/
    src/
    public/             raiz pública do site
  private/
    cti-env.php         chave e configuração
    cti-storage/        banco e gravações
~~~

Somente `cti/public` será servido pela web. Não crie banco MySQL ou PostgreSQL no painel: esta versão usa um arquivo SQLite, criado na etapa 8.

Digite `exit` para voltar ao PowerShell do Windows.

## 5. Enviar os arquivos do projeto

**Onde:** a mesma janela do PowerShell, depois de sair do SSH.

Envie a versão desta pasta local na branch `feat/mvp-hospedado-gemini`, que contém a integração preparada para o pitch. Clonar apenas a branch principal do GitHub não inclui essa entrega. Preserve também eventuais alterações locais posteriores.

~~~powershell
scp -r .\src .\database .\bin .\public "$($CtiDestino):/home/$CtiConta/cti/"
~~~

Informe a senha SSH quando solicitada. Aguarde a transferência terminar e o prompt do PowerShell reaparecer. O comando envia código e assets, sem `.git`, modelos locais, dependências Node ou uma base antiga.

Reconecte:

~~~powershell
ssh $CtiDestino
~~~

**No terminal SSH**, confira os arquivos essenciais:

~~~sh
ls -l "$HOME/cti/src/GeminiAnalyzer.php" "$HOME/cti/bin/preflight.php" "$HOME/cti/database/schema.sqlite.sql"
ls -la "$HOME/cti/public/.htaccess"
~~~

**Conferência:** todos devem aparecer sem `No such file or directory`. O `.htaccess` é oculto e precisa estar em `public`. Se faltar um arquivo, volte ao PowerShell com `exit`, confira a pasta local e repita a transferência.

Digite `exit` para preparar a configuração privada no Windows.

## 6. Criar e enviar a configuração privada

**Onde:** Bloco de Notas do Windows e, depois, PowerShell.

1. Abra o Bloco de Notas e cole o conteúdo abaixo.
2. Substitua apenas `COLE_A_CHAVE_AQUI` pela chave Gemini. Mantenha as aspas e não acrescente espaços ou quebras de linha dentro da chave.
3. Salve em `C:\Users\fbrec\Documents\cti-env.php`, fora da pasta do projeto. Escolha **Todos os arquivos** e codificação **UTF-8**. Confira que o nome não terminou em `.php.txt`.

~~~php
<?php
$ctiBase = dirname(__DIR__);
putenv('CTI_ANALYSIS_PROVIDER=gemini');
putenv('CTI_GEMINI_MODEL=gemini-3.5-flash-lite');
putenv('CTI_GEMINI_API_KEY=COLE_A_CHAVE_AQUI');
putenv('CTI_GEMINI_MAX_REQUESTS=20');
putenv('CTI_GEMINI_TIMEOUT=40');
putenv('CTI_STORAGE_PATH='.$ctiBase.'/private/cti-storage');
putenv('CTI_DB_PATH='.$ctiBase.'/private/cti-storage/cti.sqlite');
~~~

`$ctiBase` calcula a pasta da conta a partir da localização do arquivo no servidor. Por isso, envie-o exatamente para a pasta `private` criada na etapa 4.

**No PowerShell**, confira apenas o nome e envie:

~~~powershell
Get-Item -LiteralPath 'C:\Users\fbrec\Documents\cti-env.php' | Select-Object Name, Length
scp 'C:\Users\fbrec\Documents\cti-env.php' "$($CtiDestino):/home/$CtiConta/private/cti-env.php"
ssh $CtiDestino
~~~

**No terminal SSH**, restrinja a leitura e confira a sintaxe sem imprimir a chave:

~~~sh
chmod 600 "$HOME/private/cti-env.php"
php -l "$HOME/private/cti-env.php"
~~~

**Conferência:** deve aparecer `No syntax errors detected`. Se houver erro, corrija o arquivo local e envie novamente. Não use `cat` para mostrar a configuração em capturas ou mensagens. A cópia local também contém a chave; guarde-a fora do Git.

## 7. Configurar o site PHP e o HTTPS

**Onde:** navegador, painel Alwaysdata. O terminal SSH pode ficar aberto.

Abra **Web > Sites**. Se já houver um site usando `CONTA.alwaysdata.net`, edite-o. Caso contrário, clique em **Add a site**. Preencha:

- **Nome:** `CTI Escuta`, caso esse campo apareça.
- **Addresses:** `CONTA.alwaysdata.net`, com o nome real e sem `https://`.
- **Type:** `PHP`.
- **Root directory:** `/home/CONTA/cti/public`, caminho absoluto da pasta pública.

Em **Environment > PHP**, selecione PHP **8.4** para a conta dedicada à demonstração. Nas configurações PHP do próprio site em **Web > Sites**, acrescente as diretivas abaixo. Substitua `CONTA` no primeiro caminho:

~~~ini
auto_prepend_file = /home/CONTA/private/cti-env.php
upload_max_filesize = 6M
post_max_size = 7M
max_execution_time = 60
display_errors = Off
log_errors = On
~~~

`auto_prepend_file` carrega a configuração privada antes do PHP do site. Preserve outras diretivas que já existam e ajuste apenas as correspondentes. Salve.

Na seção **SSL** do site, marque **Force HTTPS** e salve. Essa opção redireciona HTTP para HTTPS; a validade do certificado será conferida ao abrir a URL. O microfone exige conexão segura.

**Conferência:** a lista deve mostrar seu endereço e a raiz terminada em `/cti/public`. Não use `/cti` como raiz. Fontes: [site PHP](https://help.alwaysdata.com/en/docs/web-hosting/sites/add-a-site/), [configuração PHP](https://help.alwaysdata.com/en/docs/web-hosting/languages/php/configuration/) e [Force HTTPS](https://help.alwaysdata.com/en/docs/web-hosting/sites/ssl-tls/redirect-http-to-https/).

## 8. Conferir requisitos e inicializar o banco

**Onde:** terminal SSH. Se estiver no PowerShell, reconecte com `ssh $CtiDestino`.

~~~sh
cd "$HOME/cti"
php -d auto_prepend_file="$HOME/private/cti-env.php" bin/preflight.php
echo $?
~~~

O `-d` aplica a configuração ao PHP do terminal. A configuração do site não é necessariamente aplicada ao CLI.

**Resultado esperado:** todas as linhas começam com `PASS` e o último comando imprime `0`. O preflight confere PHP, SQLite, `mbstring`, `curl`, caminhos e presença da chave. Ele não testa a chave no Google, não cria banco em disco e não chama Gemini.

Se houver `FAIL`, resolva antes de seguir:

- **PDO SQLite, mbstring ou curl:** volte à configuração PHP e verifique a extensão indicada. A [documentação de extensões](https://help.alwaysdata.com/en/docs/web-hosting/languages/php/extensions/) mostra como listar os módulos disponíveis. Não duplique extensões já carregadas.
- **SQLite menor que 3.35:** o ambiente ainda não atende ao código que usa `RETURNING`. Confira a versão PHP e a disponibilidade dessa versão SQLite com o suporte da hospedagem.
- **Chave ou provider:** confira as variáveis da etapa 6 e o caminho de `auto_prepend_file`.
- **Storage ou banco privado:** confira se `private/cti-storage` existe fora de `public` e pertence ao usuário SSH da conta.

Se a falha for especificamente `PDO SQLite`, execute no SSH:

~~~sh
php -m
ls "$(php-config --extension-dir)/pdo_sqlite.so"
~~~

O primeiro comando lista os módulos carregados. Se `pdo_sqlite` já aparecer, não
adicione outra entrada. Se não aparecer e o segundo comando encontrar o arquivo,
abra **Environment > PHP**, acrescente `extension = pdo_sqlite.so` às diretivas,
salve e rode o preflight novamente. A configuração global dessa extensão atende
também ao PHP do terminal. Se `php-config` ou o arquivo não existirem, confirme a
disponibilidade da extensão com o suporte do Alwaysdata; não prossiga como se o
requisito estivesse atendido. Para `mbstring` e `curl`, aplique a mesma conferência
com o nome da extensão indicada, preservando as entradas já existentes.

Depois de obter todos os `PASS`, inicialize:

~~~sh
php -d auto_prepend_file="$HOME/private/cti-env.php" bin/console.php init
~~~

**Resultado esperado:** `Banco inicializado. Base de demonstracao preservada se ja existir.` O comando cria a estrutura e carrega dados fictícios somente em banco sem usuários. Não apaga registros existentes e não processa IA.

Não execute `preparar-ia.ps1`, `iniciar.ps1` ou `analysis:work` neste servidor. O modo hospedado usa PHP chamando a API por demanda.

## 9. Conferir a URL e os perfis sem usar IA

**Onde:** navegador, `https://CONTA.alwaysdata.net`, com o nome real.

1. Confira a tela de login **CTI Escuta**, sem aviso de certificado.
2. Abra **Acessos de demonstração**. A senha das contas fictícias é `CtiDemo2026!`.
3. Entre e saia de cada perfil. O botão de saída tem o título **Sair da conta**, no rodapé da barra lateral.

- Atendente: `rafael@cti.demo`, com **Meus atendimentos** e **Registrar atendimento**.
- Cliente: `lucas@cti.demo`, com **Enviar feedback** e **Meus feedbacks**.
- Supervisor: `marina@cti.demo`, com **Dashboard da equipe**, **Feedbacks da equipe** e **Casos críticos**.
- Gestor: `helena@cti.demo`, com **Visão geral**, **Indicadores e tendências**, **Comparação entre equipes** e **Relatórios**.

**Conferência:** logins e consultas funcionam sem registrar análise. Duas abas normais compartilham sessão; use sair/entrar ou perfis de navegador separados para alternar os papéis.

Abra também `/clientes/` como Rafael e confira o formulário. Para os testes de IA, use **Grupo Aurora Logistica**, já vinculada a Lucas. Cadastrar outra empresa não cria automaticamente uma conta de cliente para ela.

Teste estes caminhos no seu domínio: `/src/App.php`, `/database/schema.sqlite.sql`, `/storage/cti.sqlite`, `/.git/config`, `/router.php` e `/api.php`. Todos devem retornar 404. Se algum mostrar conteúdo, corrija a raiz pública e o `.htaccess` antes de continuar.

## 10. Consultar o contador sem chamar Gemini

**Onde:** terminal SSH. Cole o bloco inteiro, incluindo a última linha `PHP` sozinha.

~~~sh
php <<'PHP'
<?php
require getenv('HOME').'/private/cti-env.php';
$path = getenv('CTI_DB_PATH');
if (!$path || !is_file($path)) {
    file_put_contents('php://stderr', "Banco não encontrado. Execute a etapa 8.\n");
    exit(1);
}
$db = new PDO('sqlite:'.$path);
$db->exec('PRAGMA query_only=ON');
$used = (int) $db->query("SELECT COUNT(*) FROM audit_events WHERE event='gemini_request_reserved'")->fetchColumn();
$limit = (int) (getenv('CTI_GEMINI_MAX_REQUESTS') ?: 20);
printf("Tentativas reservadas: %d\nTeto: %d\nRestantes: %d\n", $used, $limit, max(0, $limit-$used));
PHP
~~~

**Resultado esperado numa base nova:** 0 tentativas reservadas, teto 20 e 20 restantes. Anote o número antes dos testes. A consulta é somente leitura, não mostra a chave e não chama a API.

O teto é da instalação inteira e conta tentativas, inclusive falhas de rede. O pagamento do Google é separado. Aumentar o teto não corrige chave inválida, indisponibilidade ou cota do provedor.

## 11. Executar as duas chamadas reais

### 11.1 Preparar dois atendimentos, sem consumir IA

**Onde:** navegador, sistema publicado. Entre como Rafael.

1. Abra **Registrar atendimento**, na barra lateral.
2. Escolha **Cliente:** `Grupo Aurora Logistica`, **Assunto:** `Pitch - teste de texto`, **Canal:** `Portal`, **Prioridade:** `Média` e **Status do atendimento:** `Em atendimento`.
3. Clique em **Registrar atendimento**. O sistema abre a edição do registro.
4. Desça até **Solução e confirmação do cliente**. Em **Como o problema foi resolvido?**, escreva `Conexão ajustada e acesso restabelecido para validação do cliente.`
5. Clique em **Enviar solução e pedir confirmação**. Anote o protocolo e confira o status **Aguardando cliente**.
6. Repita para outro atendimento, usando o assunto `Pitch - teste de áudio`.

São necessários dois atendimentos porque cada tentativa aceita um único feedback. Não envie texto e áudio no mesmo registro para este ensaio.

### 11.2 Primeira chamada: texto

Saia de Rafael e entre como Lucas.

1. Em **Enviar feedback**, localize `Pitch - teste de texto` pelo assunto ou protocolo.
2. Clique em **Ainda preciso de ajuda** e dê nota 1.
3. Na opção **Escrever**, preencha **Seu feedback (opcional)** com:

   > O atendimento demorou e ninguém resolveu. A conexão continua caindo. Quero falar com um supervisor.

4. Marque **Revisei meu feedback e confirmo o envio.** e clique uma vez em **Enviar feedback**.
5. Aguarde o recibo. A análise é solicitada automaticamente após o envio. Cronometre o tempo até aparecer o resultado na supervisão.
6. Saia e entre como Marina. Abra **Feedbacks da equipe**, encontre o protocolo e clique em **Revisar**.

**Conferência:** o modal mostra o relato, **Análise automática original**, sentimento, criticidade, **Resumo por IA**, assuntos, evidências e a origem **Análise pela API Gemini**. Não há porcentagem de confiança para Gemini. Confira se o resultado representa o relato e registre o que o modelo retornou, sem forçar um rótulo esperado.

O cliente vê detalhes reduzidos; a conferência completa é feita por Rafael ou Marina. Se estiver pendente, aguarde a atualização. Não clique em **Analisar relato** apenas para acelerar uma requisição iniciada.

### 11.3 Segunda chamada: áudio

Saia de Marina e entre como Lucas.

1. Localize `Pitch - teste de áudio` em **Enviar feedback**.
2. Clique em **Resolveu, pode encerrar**, dê nota 5 e escolha **Gravar áudio**.
3. Clique em **Iniciar gravação** e permita o microfone.
4. Fale por 10 a 15 segundos. Sugestão: `O atendimento resolveu meu problema. A conexão voltou a funcionar e consegui retomar meu trabalho. Agradeço pela atenção da equipe.`
5. Clique em **Parar gravação**, ouça a prévia e confirme que a voz está audível. Até aqui, não houve chamada Gemini.
6. Marque a confirmação e clique uma vez em **Enviar feedback**. Aguarde o recibo.
7. Entre como Marina e abra **Revisar** no segundo atendimento. Confira reprodução do áudio, **Transcrição automática** e análise Gemini.

A interface grava pelo microfone; não oferece seleção de MP3 nesse fluxo. Há textos antigos na tela citando processamento local. Com `CTI_ANALYSIS_PROVIDER=gemini`, o processamento desta publicação acontece no Google; os textos residuais não comprovam falha de configuração.

### 11.4 Conferir que reabrir não gasta outra tentativa

1. Rode a consulta da etapa 10. O contador deve ter aumentado em 2, se ambas as solicitações chegaram ao processamento e ninguém mais pediu análises.
2. Feche e reabra os dois detalhes e atualize a página.
3. Consulte de novo. O número deve continuar igual: resultados concluídos são lidos do banco.

Se uma análise falhar, ela também pode ter consumido uma reserva. Registre a mensagem e confira o diagnóstico antes de repetir. **Tentar análise novamente** é uma ação explícita do supervisor e pode gastar outra tentativa. Não rode uma suíte de inferência real para investigar configuração.

## 12. Ensaiar e deixar uma reserva para o pitch

Reaproveite os dois resultados reais salvos como exemplos de reserva, identificando-os como previamente processados. Abri-los não exige nova análise.

Como Marina, registre **Sentimento**, **Criticidade**, **Justificativa da revisão** e **Providência para resolver o problema**; clique em **Salvar revisão**. Isso demonstra a decisão humana sem chamar Gemini.

Como Helena, mostre os indicadores e filtros da gestão. O gestor consulta resultados; não executa revisão nem análise. Abra a URL em outro computador ou celular e confira login, navegação e HTTPS.

Anote URL, protocolos e tempos medidos. Evite novos feedbacks a cada ensaio: preserve tentativas para o dia do pitch.

## Se algo der errado

- **Página padrão do Alwaysdata:** em **Web > Sites**, confira endereço e raiz `/home/CONTA/cti/public`.
- **404 em todas as rotas da API:** confira `public/.htaccess` e o tipo PHP do site. Não use hospedagem configurada como site estático.
- **Erro 500:** consulte os logs do site no painel. Por SSH, o log PHP documentado fica em `$HOME/admin/logs/php/php.log`. Confira `auto_prepend_file`, permissões e extensões. Retire dados privados antes de compartilhar logs.
- **Preflight passa, mas a página falha:** compare o PHP da web e o do terminal. A configuração do site e a do CLI podem ser diferentes.
- **Falha durante análise:** consulte o log PHP. O arquivo `analysis-errors.log` da execução local não é necessariamente criado pelo modo web.
- **429 ou limite da demonstração:** consulte o contador. Com teto local atingido, o responsável pode rever `CTI_GEMINI_MAX_REQUESTS` no arquivo privado e reenviá-lo. Com saldo local, confira a cota do projeto no AI Studio. A configuração aceita de 1 a 1000; o padrão é 20.
- **Credencial ou modelo recusado:** confira chave, projeto e disponibilidade de `gemini-3.5-flash-lite` na conta. Identifique a causa antes de gastar outra tentativa.
- **Microfone não abre:** confira HTTPS, permissão do site e dispositivo de entrada. Gravar e ouvir a prévia não usa Gemini; enviar o feedback solicita a análise.
- **Pendência após interromper conexão:** confira lista e contador. A interface não repete falhas automaticamente. Um atendente ou supervisor pode solicitar a análise pendente nos detalhes, após conferir que não há outra em andamento.

Fontes de diagnóstico: [logs PHP](https://help.alwaysdata.com/en/docs/web-hosting/languages/php/configuration/), [logs do site](https://help.alwaysdata.com/en/docs/web-hosting/sites/add-a-site/) e [cotas Gemini](https://aistudio.google.com/docs/rate-limits).

## Como explicar o limite de áudio no pitch

> O MVP recebe gravações de até 60 segundos para demonstrar captura, transcrição, análise e revisão humana com consumo e tempo medidos. Na versão final, propomos importar chamadas completas MP3/WAV, processá-las em fila com progresso e recuperação de falhas e consolidar as análises por trecho.

Esse é o recorte do nosso sistema, não um limite de 60 segundos do Gemini.

## Checklist para encerrar

- [ ] A URL HTTPS abre em outra máquina, sem aviso de certificado.
- [ ] A raiz pública é `cti/public` e caminhos privados retornam 404.
- [ ] O preflight passou e os quatro perfis conseguem entrar.
- [ ] Um texto foi analisado de verdade e seu resultado ficou salvo.
- [ ] Um áudio curto foi transcrito e analisado de verdade.
- [ ] Os tempos e protocolos foram anotados.
- [ ] Reabrir resultados não aumentou o contador.
- [ ] Os exemplos de reserva estão prontos e as limitações têm explicação.

Este documento descreve o procedimento. Cadastro, cobrança, publicação, certificado e chamadas reais só ficam verificados depois de executar as etapas na conta e na URL finais.
