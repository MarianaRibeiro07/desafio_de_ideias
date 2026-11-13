# Operação do CTI Escuta

## Executar no Windows

Abra o PowerShell na pasta `cti-escuta` e execute:

```powershell
.\iniciar.ps1
```

O script usa PHP e Node disponíveis no `PATH`, chama a inicialização do banco, inicia o worker de IA em segundo plano e abre o servidor em `http://localhost:8080`. Para escolher outra porta, execute `.\iniciar.ps1 -Porta 8081`. O terminal permanece ocupado pelo servidor; use `Ctrl+C` para encerrar o servidor e seu worker.

Na primeira execução, se as dependências ou os modelos não estiverem preparados, o script chama `preparar-ia.ps1`. Essa preparação precisa de internet para instalar os pacotes registrados no lockfile e baixar os pesos dos modelos. Nesta máquina, dependências e modelos já foram instalados e validados. Para preparar novamente, execute `.\preparar-ia.ps1` na pasta do projeto. Depois da preparação, o processamento usa os modelos locais e não exige chave de API ou assinatura.

O comando direto de inicialização usado pelo script é `php bin/console.php init`. O roteador é `public/router.php`. Não abra o HTML com duplo clique: autenticação, banco e operações dependem do servidor PHP.

Para executar os comandos manualmente:

```powershell
php bin/console.php init
php -d upload_max_filesize=6M -d post_max_size=7M -S 127.0.0.1:8080 -t public public/router.php
```

Ao iniciar manualmente, abra outro terminal na mesma pasta e execute `php bin/console.php analysis:work` para consumir a fila e executar a manutenção. O script `iniciar.ps1` já faz isso automaticamente.

Os limites de upload acompanham o tamanho aceito para a gravação, evitando que o PHP descarte o envio antes da validação da aplicação.

O ambiente precisa de PHP 8.4 com `PDO`, `pdo_sqlite` e `mbstring`, Node.js 20 ou superior e npm. O backend não usa Composer. As dependências de inferência ficam em `ai/package.json` e `ai/package-lock.json`. A instalação foi validada com Node.js 24.12.0 e PHP 8.4.1 nesta máquina.

Por padrão, o banco fica em `storage/cti.sqlite` e as gravações em `storage/audio/`, fora da pasta pública. `CTI_DB_PATH` permite escolher outro arquivo de banco e `CTI_STORAGE_PATH` altera a pasta de armazenamento. A inicialização cria as tabelas e carrega demonstração somente quando a tabela de usuários está vazia; não execute comandos de exclusão para atualizar uma instalação existente.

## Contas de demonstração

Os testes de integração definem a senha `CtiDemo2026!` para as contas abaixo. Os dados são sintéticos, sem relação com atendimentos reais.

| Perfil | E-mail |
|---|---|
| Atendente | `rafael@cti.demo` |
| Supervisor | `marina@cti.demo` |
| Gestor | `helena@cti.demo` |
| Cliente | `lucas@cti.demo` |

A base de demonstração é determinística e sintética, carregada somente em banco vazio, com datas relativas à primeira inicialização. Ela tem 9 usuários, 42 atendimentos e 31 feedbacks (32 atendimentos e 21 feedbacks nos últimos 30 dias, e 10 atendimentos resolvidos com feedback entre 31 e 54 dias atrás, para a comparação com o período anterior aparecer em `GET /api/reports` sem filtros), em duas equipes, quatro atendentes, seis clientes e quatro canais. Inclui feedbacks positivos, neutros e negativos (notas 1 e 2 com as frases de criticidade da entrevista), seis críticos sem revisão e três já revisados (um recente e dois do período anterior, um em cada equipe), três atendimentos ativos em que o cliente informou que não resolveu, duas análises com falha, e para o atendente `rafael@cti.demo` uma resposta vencida e outra prevista para as próximas 24 horas. As análises concluídas se identificam com o modelo `demonstracao-sintetica`; nada disso vem de dados da empresa, que não forneceu exemplos anonimizados.

Cada login deve ser feito em sua própria sessão de navegador. Para comparar perfis simultaneamente, use navegadores diferentes ou uma janela anônima; abas do mesmo navegador compartilham sessão.

## Processo de atendimento

O atendente registra o caso e usa o mesmo formulário para atualizar seus dados. Ao preencher o assunto, pode consultar correspondências e casos de solução já existentes no banco. Essa busca é textual: não é pesquisa semântica nem geração de resposta por inteligência artificial.

Se o cliente (empresa) ainda não existe na lista, o atendente o cadastra antes, informando apenas o nome (3 a 120 caracteres). Nomes repetidos, sem diferenciar maiúsculas e minúsculas, são recusados com mensagem de duplicidade; a checagem roda em transação e há um índice único no banco (`clients_name_nocase`). Se uma base antiga já tiver duplicatas, a inicialização não cai: o índice deixa de ser criado e uma linha no log de erros do PHP avisa, até que os cadastros repetidos sejam resolvidos e `php bin/console.php init` rode de novo. O cliente cadastrado fica disponível para atendente, supervisor e gestor.

Ao registrar, o atendente escolhe o status inicial. "Ativo" é o padrão. "Resolvido" exige a solução (10 a 2.000 caracteres) e significa solução enviada e aguardando confirmação do cliente: o atendimento não é encerrado, o prazo de 72 horas conta do registro e a única mudança manual do atendente é consumida, então não há segundo envio de solução.

O envio da solução é a única ação manual do atendente que muda a etapa do atendimento. A partir desse envio, começa o prazo de 72 horas para o cliente confirmar se o problema foi resolvido. A confirmação encerra como resolvido. Se o cliente declarar que o problema continua, o caso permanece ativo e não pode encerrar por ausência de resposta àquela tentativa.

Se o cliente não responder dentro de 72 horas, o sistema pode encerrar como sem retorno. Esse resultado possui contagem própria e não entra como resolução confirmada. O supervisor da equipe pode enviar nova tentativa com solução e justificativa, preservando o histórico e abrindo novo prazo de 72 horas. O usuário confirmou expressamente que a liberação da nova tentativa cabe ao supervisor.

O cliente responde dentro de sua área autenticada, sem depender de link recebido. Pode usar a avaliação rápida e a confirmação de resolução. Para detalhar, usa texto com até 500 caracteres e cinco linhas, gravação de até 60 segundos ou um arquivo de áudio anexado de até 60 segundos, escolhendo só uma dessas formas por envio. O formato do anexo depende do que o navegador consegue decodificar; o arquivo é convertido em WAV antes de sair do computador do cliente.

## Supervisão e relatórios

O supervisor resolve as pendências da equipe: revisa feedbacks críticos no modal, consultando casos de resolução relacionados antes de registrar ação e justificativa, tenta de novo análises com falha e envia nova tentativa justificada quando o cliente informa que não resolveu. Sugestões automáticas não substituem essa revisão.

O atendente recebe indicadores dos próprios atendimentos. O gestor avalia os resultados da organização: indicadores gerais, histórico, comparações entre equipes, filtros de relatório e exportação, sem operar pendências e sem alertas. Os filtros não concedem acesso a registros fora do escopo do perfil.

O botão "Exportar atendimentos filtrados" gera CSV com protocolo, assunto, equipe, canal, status, data e motivo do encerramento. Esses campos também são informados na interface. O arquivo contém atendimentos individuais no escopo e filtros escolhidos, inclusive para o gestor; os indicadores agregados permanecem no painel.

Os lembretes aparecem no sistema e dependem do perfil. O atendente vê resposta atrasada ou prevista nas próximas 24 horas e clientes que informaram não ter resolvido. O supervisor vê feedbacks críticos sem revisão e clientes que informaram não ter resolvido, e não recebe lembrete de resposta. O gestor não recebe alertas. O cliente vê os pedidos de confirmação. No relatório, a lista de respostas vencidas só é preenchida para o atendente. Não há confirmação de envio por e-mail, WhatsApp ou telefonia: esses serviços não foram fornecidos e não devem ser presumidos pela interface.

Enquanto o portal está aberto, a interface consulta atualizações a cada 60 segundos e ao retomar a aba. O contador e o aviso de lembrete atualizam sem reconstruir o formulário nem apagar o rascunho. Se a sessão expirar, a interface apresenta o login e permite autenticar novamente sem recarregar a página.

## Manutenção e retenção

Execute a manutenção na pasta do projeto:

```powershell
php bin/console.php maintenance
```

O comando retorna JSON com `closed_no_response`, `redacted_feedbacks` e `executed_at`. Ele encerra tentativas sem retorno elegíveis após 72 horas, remove conteúdo antigo e limpa tentativas antigas de login. A aplicação também chama manutenção ao carregar os dados do portal, no envio de feedback e a cada ciclo do worker. Com `iniciar.ps1`, o worker mantém a rotina ativa enquanto o servidor está em execução.

Se a implantação não mantiver o worker ativo, configure esse comando no agendador do ambiente, por exemplo a cada cinco minutos, com diretório de trabalho na pasta do projeto. A rotina é idempotente; executá-la novamente não duplica o encerramento.

O argumento opcional `--now` recebe uma data ISO 8601 para simular tempo em testes. Não use datas futuras sobre o banco que deseja preservar, porque o descarte de conteúdo não pode ser desfeito pela aplicação.

### Exclusão sob demanda

Para remover o conteúdo de um feedback antes do prazo (pedido de exclusão do titular, por exemplo):

```powershell
php bin/console.php redact --feedback=ID
```

O comando faz o mesmo descarte da retenção (texto, transcrição, resumo, temas, evidências, arquivo de áudio e texto das revisões), preserva os dados estruturados dos indicadores e registra o evento `content_redacted` na auditoria. A saída é JSON, por exemplo `{"feedback_id":12,"protocol":"FDB-2026-0012","status":"redacted","redacted_at":"2026-11-06T18:00:00+00:00","audio_removed":true}`. Rodar de novo devolve `"status":"already_redacted"` sem nova auditoria. ID inexistente ou argumento inválido sai com código 1 e mensagem em stderr. O campo `audio_removed` só é `true` quando o arquivo de áudio existia e foi apagado; arquivo ausente ou falha ao apagar dá `false`, e a falha entra no log de erros do PHP com o nome do arquivo. O descarte não pode ser desfeito pela aplicação. Ele não apaga nomes de contas, assuntos, soluções nem eventos de auditoria.

### Mascaramento de dados pessoais

O texto do feedback e a transcrição de áudio têm CPF, telefone (com DDD, com DDD de zero à esquerda como `011`, ou celular sem DDD iniciado em 9, como `98765-4321`) e e-mail trocados por `[CPF omitido]`, `[telefone omitido]` e `[e-mail omitido]` antes de gravar. É regra por padrão (expressão regular), não anonimização completa: nomes próprios e endereços continuam no texto, 11 dígitos soltos viram CPF mesmo se forem celular, fixo sem DDD de 8 dígitos não é reconhecido, e dados gravados antes desta versão não são reprocessados. Para um caso específico, use o comando `redact` acima.

O prazo local de retenção de conteúdo é 12 meses. A rotina remove texto, transcrição, resumo, temas, evidências e arquivo de áudio do feedback, justificativas e ações antigas de revisão, e mensagens antigas. Preserva indicadores estruturados. A extensão desse prazo ao áudio é uma decisão desta versão, pois a política corporativa não foi fornecida. Isso não anonimiza nomes, organizações, assuntos e soluções dos atendimentos; consulte a [arquitetura](arquitetura.md) antes de usar dados reais.

## Backup

O comando copia o banco SQLite de forma consistente (`VACUUM INTO`, seguro mesmo com o servidor em uso) e o diretório de áudio para uma pasta datada:

```powershell
php bin/console.php backup --dir=D:\backups-cti --keep=30
```

`--dir` define a pasta de destino (padrão `storage/backups`) e `--keep` quantas cópias ficam (padrão 30; as mais antigas são apagadas). Cada execução cria `cti-backup-AAAAMMDD-HHMMSS/` com `cti.sqlite` e `audio/`, e imprime o caminho e o tamanho. Só pastas com esse nome são consideradas na retenção; nada mais dentro de `--dir` é tocado. O banco e a pasta de áudio seguem `CTI_DB_PATH` e `CTI_STORAGE_PATH`.

Rotina sugerida:

- **Frequência:** diária, de madrugada (por exemplo às 03:00), quando quase não há atendimento.
- **Cópia fora do servidor:** `--dir` não protege contra perda do próprio disco. Aponte para um disco externo ou sincronize a pasta com armazenamento em nuvem (cliente de sincronização do provedor ou uma ferramenta como rclone).
- **Retenção:** guardar 30 dias (`--keep=30`, com uma cópia por dia).
- **Teste de restauração:** uma vez por mês, restaure a cópia mais recente em outra pasta, aponte `CTI_DB_PATH` e `CTI_STORAGE_PATH` para ela, rode `php bin/console.php init` e abra o sistema em outra porta para conferir que os atendimentos aparecem. Backup que nunca foi restaurado é só uma suposição.

Para restaurar de verdade: encerre o servidor e o worker, copie `cti.sqlite` da cópia para o caminho do banco (`storage/cti.sqlite` por padrão), copie `audio/` para `storage/audio/` e inicie de novo.

Agendador de Tarefas do Windows (execute uma vez em um terminal; ajuste os caminhos):

```powershell
schtasks /Create /SC DAILY /ST 03:00 /TN "CTI Escuta Backup" /TR "php C:\caminho\do\projeto\bin\console.php backup --dir=D:\backups-cti --keep=30"
```

A tarefa usa o `php` do PATH do usuário que a criou; se preferir, informe o caminho completo do `php.exe`. Conferir com `schtasks /Query /TN "CTI Escuta Backup"` e testar com `schtasks /Run /TN "CTI Escuta Backup"`.

cron (Linux), com `crontab -e`:

```
0 3 * * * cd /caminho/do/projeto && php bin/console.php backup --dir=/mnt/backup-externo/cti --keep=30 >> storage/backup.log 2>&1
```

## IA e transcrição locais

Texto e áudio aparecem inicialmente como aguardando análise. A gravação é transcrita por Whisper tiny em português e classificada pelo modelo twitter-XLM-RoBERTa. Os nomes e revisões estão registrados na [arquitetura](arquitetura.md). A avaliação rápida sem texto ou áudio continua baseada na nota. A análise não altera a confirmação de resolução nem a revisão humana existente.

O detalhe do feedback apresenta a transcrição, análise automática original, score do modelo, resumo extrativo, assuntos, evidências e revisão humana atual. O score não comprova a precisão do modelo para a CTI; é a saída da classe escolhida. Resumo e assuntos usam extração e regras locais explicitadas na tela.

Falhas mantêm a gravação e o feedback. O supervisor da equipe pode usar a ação de tentar a análise novamente. Gravação silenciosa, modelo ausente ou tempo excedido produzem falha em vez de resultado inventado. Diagnósticos técnicos ficam em `storage/analysis-errors.log`, e as conclusões de jobs em `storage/analysis-worker.log`. Com `CTI_STORAGE_PATH`, os logs ficam na pasta escolhida.

`php bin/console.php analysis:once` processa no máximo um feedback e retorna JSON; `analysis:work` acompanha a fila continuamente. `CTI_NODE_PATH` seleciona o executável Node e `CTI_MODEL_CACHE_PATH` seleciona o cache, cujo padrão é `storage/models`. `CTI_ANALYSIS_TIMEOUT` configura de 1 a 600 segundos por job, com padrão de 300 segundos. Após uma interrupção, jobs em processamento por mais de 15 minutos viram falha recuperável.

O modelo carrega na CPU a cada processo de análise, sem serviço externo. Nos testes locais, uma análise curta levou poucos segundos; o tempo de gravações de 60 segundos e de outras máquinas não foi estabelecido como garantia de desempenho. Uma implantação contínua precisa manter o worker ativo junto do servidor.

## Validação

O teste de integração pode ser executado com:

```powershell
php tests/backend.php
```

Ele usa banco temporário e verifica o conteúdo da base de demonstração (feedbacks negativos, neutros, positivos, críticos sem revisão, negativas do cliente e análise com falha), autenticação, CSRF, acesso por perfil, cadastro de cliente, registro com status inicial, alertas e relatório por perfil, registro e edição, confirmação do cliente, nova tentativa do supervisor, histórico por tentativa, fechamento após 72 horas, limites de texto, WAV de 60 e 61 segundos, acesso privado ao áudio, revisão e relatórios.

### Rodada final com IA e protótipo exportado, 2026-11-06

| Comando ou conferência | Resultado observado |
|---|---|
| `php tests/backend.php` | 70 verificações aprovadas, saída 0 |
| `php tests/analysis.php` | 40 verificações aprovadas, saída 0 |
| `node tests/ai.mjs` | WAV, reamostragem, silêncio, evidências longas e sinais críticos aprovados, saída 0 |
| `node tests/ai-models.mjs storage/qa/portugues-pcm.wav`, com `CTI_TEST_OFFLINE=1` | Inferência positiva, negativa, neutra e transcrição real aprovadas com `fetch` bloqueado, saída 0 |
| `php tests/ai-end-to-end.php storage/qa/portugues-pcm.wav` | 10 verificações reais de IA aprovadas, saída 0 |
| `node tests/http.mjs`, em QA isolado 8088 | 21 verificações HTTP aprovadas, saída 0 |
| `node tests/browser.mjs`, em QA isolado 8096 | 58 de 58 verificações aprovadas, saída 0, também executado pelo agente principal |
| `node --check public/app.js`, `node --check ai/engine.mjs` e lint PHP | Sem erros de sintaxe |
| Parser PowerShell em `iniciar.ps1` e `preparar-ia.ps1` | Sem erros de sintaxe |
| `iniciar.ps1 -Porta 8088` | Servidor e worker iniciados juntos; log registrou jobs concluídos |
| `iniciar.ps1 -Porta 8080` e consultas a `/` e `/api/session` | Aplicação local iniciada com worker e ambas as rotas retornaram 200 |

As suítes com contador somam 199 verificações aprovadas, além das asserções Node sobre áudio e inferência. As capturas e o [resultado estruturado do navegador](../storage/qa/resultado.json) correspondem à rodada de 58 verificações. Todas as rotas foram capturadas; login, dashboard, registro, modal, indicadores, comparação, relatórios, 404 e larguras móveis foram inspecionados visualmente contra as imagens fornecidas. Ajustes incluem fundo, azul principal, sidebar, modal de 720 pixels e a disposição específica dos painéis do gestor.

O teste real de sentimento verificou exemplos em português com scores de 0,8809 para positivo, 0,9519 para negativo e 0,8391 para neutro. O teste de áudio usou a [amostra portuguesa pública do XTTS-v2](https://huggingface.co/coqui/XTTS-v2/blob/main/samples/pt_sample.wav), convertida de WAV float32 para PCM16 apenas para compatibilidade com o formato de gravação do portal. O Whisper produziu: "Quando eu tinha seis anos eu vi uma vez uma imagem magnífica." O caminho PHP para Node, persistência e consulta autenticada foi validado com essa mesma amostra, sem usar respostas simuladas.

A auditoria independente encontrou e motivou testes para evidência de áudio longa, expressão "ninguém resolveu" e preservação da origem por nota após revisão de avaliação rápida. Os três foram corrigidos. O primeiro classificador também foi substituído após falhar no exemplo neutro; os testes finais usam o modelo e a revisão registrados na arquitetura.

Um backup do banco anterior à migração foi preservado em `.local/cti-before-ai-20261106-093803.sqlite`, fora da pasta pública. A migração acrescenta campos sem apagar atendimentos ou feedbacks; registros com conteúdo antigo elegível entram na fila local. Modelos e dependências já estão instalados nesta máquina; os pesos mantidos ocupam aproximadamente 340 MB.

Após iniciar a aplicação principal, a comparação do backup com o banco atual confirmou os mesmos 9 usuários, 32 atendimentos e 18 feedbacks. `PRAGMA integrity_check` retornou `ok`, e `foreign_key_check` retornou zero ocorrências. Os 18 feedbacks existentes concluíram a análise local, sem criar registros de QA na base principal.

### Histórico de validação de 2026-11-05

Resultados observados na primeira entrega:

| Verificação | Resultado |
|---|---|
| `php tests/backend.php` | `65 verificacoes aprovadas.`, código de saída 0, também executado pelo agente principal |
| `php bin/console.php maintenance` | `closed_no_response=0`, `redacted_feedbacks=0`, `executed_at=2026-11-05T19:31:19+00:00`, código de saída 0, conferido pelo agente de backend |
| `php -l` nos cinco arquivos PHP da entrega | Sem erros de sintaxe, conferido pelo agente principal |
| `node --check public/app.js` | Código de saída 0, conferido pelo agente principal |
| `node tests/http.mjs` no servidor de QA isolado | `21 verificações HTTP aprovadas`, código de saída 0, execução conferida pelo agente principal |
| `node tests/browser.mjs` | 55 de 55 verificações aprovadas, código de saída 0, execução conferida pelo agente principal |
| Servidor local em `http://localhost:8080` | `GET /` e `GET /api/session` retornaram 200, conferido pelo agente principal |
| Banco local de demonstração | `PRAGMA integrity_check` retornou `ok`, `foreign_key_check` sem ocorrências, 11 tabelas, 32 atendimentos e nenhum atendimento de QA, conferido pelo agente principal |
| `GET /src/App.php`, `/database/schema.sqlite.sql`, `/storage/cti.sqlite` e `/.git/config` no servidor de QA | 404 em todos, conferido pelo agente principal |
| `GET /api/session` | 200 e cookie `HttpOnly` com `SameSite=Strict`, conferido pelo agente principal |
| Login sem token CSRF | 419, conferido pelo agente principal |
| `GET /assets/cti-oficial.png` | PNG, 14.160 bytes, hash igual ao original fornecido, conferido pelo agente principal |
| `Invoke-WebRequest http://localhost:8095/assets/inter-400.ttf` | 200, `font/ttf`, 324.820 bytes |

O teste HTTP usa `CTI_BASE_URL` ou `http://127.0.0.1:8095` e cria registros no servidor de destino. Execute-o somente contra banco e armazenamento separados dos dados que deseja preservar. O agente principal utilizou `CTI_DB_PATH` e `CTI_STORAGE_PATH` isolados, com os limites PHP de 6 MB para upload e 7 MB para o corpo da requisição.

A validação HTTP enviou um WAV real de 60 segundos a 48 kHz com 5.760.044 bytes e comparou o download byte a byte. Também confirmou rejeição de WAV de 61 segundos, bloqueio de texto junto com áudio, acesso proibido por outro cliente e ausência de acesso anônimo ao arquivo. Isso verifica transporte e validação do arquivo; não comprova captura física do microfone.

A rodada final de navegador utilizou Edge em modo headless com CDP, nos quatro perfis, com tela de 1.440 pixels e largura móvel de 390 pixels. O [resultado estruturado](../storage/qa/resultado.json) registra 55 verificações aprovadas. As capturas ficam em `storage/qa/`, incluindo [registro de atendimento](../storage/qa/atendimento-criado-1440.png), [revisão do supervisor](../storage/qa/supervisor-revisao-1440.png) e [filtro de criticidade](../storage/qa/gestor-filtro-criticidade-1440.png).

O fluxo conferido cobre login pela interface, cadastro e edição na mesma rota, autocomplete com dados do banco, envio único de solução sem encerrar antecipadamente, exclusividade de texto e áudio, captura e prévia WAV com dispositivo sintético, feedback rápido negativo mantendo o atendimento ativo, consulta de casos e revisão com histórico, nova tentativa do supervisor sem alterar o limite do atendente, e filtros de equipe e criticidade do gestor comparados com o banco. Também confere atualização do contador e aviso de lembrete preservando o mesmo formulário e seu rascunho, além de expiração da sessão e novo login sem recarregar a página. A execução não encontrou exceções de JavaScript nem assets quebrados.

Na rodada de 2026-11-05, backend, HTTP e navegador somaram 141 verificações aprovadas. A captura de áudio foi testada com dispositivo sintético, não com o microfone físico da máquina. Naquela rodada, seis telas e os SVGs originais estavam pendentes por limite do serviço.

### Atualização de 2026-11-06

O envio de feedback após o prazo foi reproduzido por um teste que falhou antes da correção: `Feedback vencido bloqueado sem consulta previa ao portal`, saída 1. A API agora executa manutenção no envio e confere novamente o prazo dentro da transação. O atendimento vencido fica encerrado sem retorno, sem avaliação registrada.

| Verificação executada após a correção | Resultado |
|---|---|
| `php tests/backend.php` | 70 verificações aprovadas, saída 0; também repetido pela revisão independente |
| `node tests/http.mjs` | 21 verificações HTTP aprovadas, saída 0 |
| `node tests/browser.mjs` | 55 de 55 verificações aprovadas, saída 0; quatro perfis e larguras 1440 e 390 pixels |
| `php -l src/App.php` | Sem erros de sintaxe |
| `node --check public/app.js` | Saída 0 |

Total desta rodada: 146 verificações aprovadas. O teste HTTP e o navegador utilizaram o servidor de QA na porta 8095, com banco `.local/cti-final-qa.sqlite` e armazenamento `.local/cti-final-qa-storage`, separados do banco da aplicação. O [resultado do navegador](../storage/qa/resultado.json) e suas capturas foram atualizados. Login, dashboard do supervisor e feedbacks em largura móvel também foram inspecionados visualmente pelo agente principal.

Os endereços de assets presentes nos contextos salvos do Figma ainda estavam válidos. Foram baixados 57 SVGs originais; 45 foram aplicados e mantidos em `public/assets/figma/`, e os 12 arquivos recém-baixados sem uso foram removidos. A interface usa arquivos locais na navegação, login, filtros, métricas, seleção de formato e ações. A marca oficial foi preservada. A expressão de erro em francês foi substituída por português.

Os três PDFs do repositório foram baixados e relidos nesta etapa. Naquele momento, IA e transcrição ainda não estavam implementadas, e o Figma recusou nova consulta ao nó `10:2` por limite do plano Starter. A implementação local de modelos e a consulta das 22 imagens fornecidas depois estão descritas acima e encerram essas pendências técnicas.

## Limites da entrega

Volume: o MVP carrega todos os registros do escopo do usuário a cada carga e foi medido até 10.000 tickets de teste. O servidor responde em menos de 2 s, mas o navegador passa a levar cerca de 2 s por tela com 5.000 tickets. O caminho de crescimento, com gatilhos e critérios, está em [escalabilidade](escalabilidade.md).

Não foi realizado treinamento ou ajuste com uma base de atendimentos reais da CTI. Os testes reais demonstram inferência e persistência, sem certificar precisão corporativa. O microfone físico da máquina não foi testado: o navegador usa dispositivo sintético, e a transcrição real foi conferida com uma amostra pública em português.

O limite do Figma foi contornado para consulta visual usando as 22 imagens exportadas fornecidas pelo usuário na pasta `Downloads/CTI Escuta - Protótipo alta fidelidade`. As diferenças funcionais previamente confirmadas prevalecem sobre as imagens: marca oficial, atualização no mesmo formulário, confirmação dentro do portal, nota e resolução, limites de texto e gravação, revisão humana e exportação dos dados reais. Os SVGs usados foram recuperados dos contextos salvos. A logo oficial está em `public/assets/cti-oficial.png`, e os pesos 400, 500, 600 e 700 da fonte Inter também são locais. A comparação não equivale a um teste automático de igualdade de pixels com os dados estáticos do protótipo.
