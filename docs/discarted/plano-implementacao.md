# Histórico do plano: CTI Escuta

Data: 2026-11-05
Encerrado em 2026-11-06. O escopo local foi implementado e validado: comparação das 22 imagens fornecidas, IA de sentimento e transcrição locais, fila, recuperação de falhas e revisão humana. As suítes numeradas somaram 199 verificações aprovadas, além dos testes Node de áudio e inferência offline. O texto abaixo preserva as decisões e pendências históricas anteriores à conclusão. A documentação atual está em `docs/operacao.md` e `docs/arquitetura.md` na raiz do projeto.

## Problema

Os registros de atendimento e as avaliações dos clientes precisam ficar no mesmo sistema. O atendente precisa registrar e atualizar o atendimento sem alternar entre telas, consultar soluções anteriores e receber lembretes de retorno. O gestor e o supervisor precisam de informações compatíveis com suas responsabilidades, sem confundir ausência de resposta com resolução.

## Fundamentação

O repositório de referência contém documentação, sem aplicação ou diagrama de banco existente. Foram lidos os PDFs de ideia geral, entrevista e relatório. O arquivo `tests/backend.php:4` estabelece a aplicação PHP e o contrato de testes de integração com banco temporário; `tests/backend.php:48` verifica que enviar solução aguarda confirmação, e o restante do teste cobre autorização, limites de feedback e fechamento após 72 horas. As linhas podem mudar durante a implementação.

O Figma é a referência visual. As mudanças de fluxo e a substituição da identidade provisória pela imagem oficial fornecida pelo usuário têm precedência sobre o desenho original.

## Escopo de dentro

- Autenticação por sessão e quatro perfis: cliente, atendente, supervisor e gestor.
- Banco relacional persistente, chaves estrangeiras e histórico de operações.
- Registro e atualização de atendimento no mesmo formulário.
- Consulta de assuntos e casos de solução no banco.
- Uma ação manual de envio da solução, seguida de confirmação do cliente ou prazo de 72 horas.
- Feedback rápido no sistema, texto limitado ou gravação curta, sem upload de áudio do cliente.
- Revisão humana de feedback e consulta de soluções anteriores no modal do supervisor.
- Lembretes de resposta, relatórios por escopo, filtros e exportação.
- Documentação do modelo, operação e limites observados na validação.

## Escopo de fora

- Integração com WhatsApp, e-mail, telefonia ou outros sistemas externos, pois não foram fornecidos canais nem credenciais.
- Transcrição automática e modelos de inteligência artificial externos sem serviço configurado. Regras locais devem ser identificadas como heurística.
- Busca semântica com embeddings. A consulta de casos será textual sobre o banco.

## Critérios de aceite

- [x] As credenciais de demonstração autenticam cada perfil e o servidor restringe seu escopo.
- [x] Atendente registra e atualiza no mesmo formulário, consultando casos no banco.
- [x] O servidor impede alteração direta de status e segundo envio manual de solução.
- [x] A confirmação do cliente resolve; negativa mantém o caso ativo e impede fechamento por ausência de resposta.
- [x] Sem resposta, o atendimento encerra após 72 horas e aparece separado de resolvido no relatório.
- [x] Texto excedendo 500 caracteres ou cinco linhas é recusado no servidor.
- [x] Gravação excedendo 60 segundos é recusada no servidor e texto e áudio são exclusivos.
- [x] Supervisor revisa feedback da equipe e consulta casos relacionados.
- [x] Relatórios e exportação preservam o escopo do usuário ao aplicar filtros.
- [x] Imagem oficial da CTI é usada nas telas e não depende de URL temporária.
- [x] Testes de regra de negócio, verificações HTTP e conferência visual têm resultados registrados.
- [ ] Reprodução visual exata conferida com contexto completo das 23 telas e todos os SVGs originais do protótipo.

## Decisões já tomadas

| Decisão | Porquê |
|---|---|
| PHP 8.4 e PDO, HTML, CSS e JavaScript sem dependências de execução | Rodar localmente sem instalação de framework ou Composer |
| SQLite local e schema MySQL equivalente | Disponibilizar banco persistente imediatamente e documentar o modelo relacional |
| Atualização dentro do registro de atendimento | Evitar tela exclusiva para a mesma tarefa |
| Status derivado das ações, sem seletor livre | Impedir encerramento manual sem confirmação ou prazo |
| Prazo de 72 horas começa após envio da solução | Não encerrar atendimento apenas por ter sido criado há três dias |
| Encerrado sem retorno é diferente de resolvido | Ausência de resposta não comprova solução |
| Feedback negativo mantém atendimento ativo | Impedir que o timeout esconda problema declarado pelo cliente |
| Nova tentativa somente pelo supervisor da equipe, com solução e justificativa | Dar continuidade após negativa sem permitir novo envio manual do atendente |
| Feedback único por tentativa numerada, com histórico preservado | Permitir avaliar uma nova solução sem sobrescrever a avaliação anterior |
| Avaliação autenticada dentro do portal | Responder rapidamente sem gerar ou distribuir link |
| Somente texto ou gravação curta no feedback detalhado | Aplicar o pedido de remover anexo de áudio e bloquear alternativas simultâneas |
| Dados de demonstração sintéticos | A empresa não forneceu exemplos anonimizados |
| Consultas a cada 60 segundos e ao retomar a aba, preservando o formulário | Atualizar lembretes sem interromper o preenchimento ou perder rascunhos |

Em 2026-11-05, o usuário confirmou expressamente: "Sim, supervisor libera a nova tentativa". A implementação mantém esse controle na ação autenticada do supervisor da equipe.

## Schema e migration

A modelagem é nova e será registrada em `arquitetura.md` a partir do schema implementado. O schema SQLite e seu equivalente MySQL devem incluir usuários, equipes, clientes, atendimentos, assuntos, casos de solução, feedbacks, revisões e eventos, conforme os nomes reais definidos no backend. Criação do banco local e carga de demonstração devem ser idempotentes e nunca apagar dados existentes.

## Contrato de API

Os testes existentes definem respostas com `status` e corpo `body.data`, autenticação por sessão, token CSRF em mutações e rotas sob `/api`. Incluem `/api/session`, `/api/login`, `/api/bootstrap`, `/api/tickets`, `/api/feedbacks`, `/api/cases` e `/api/reports`. A tabela completa e os campos efetivamente implementados serão registrados em `arquitetura.md`, sem duplicar contrato especulativo neste plano.

## Fases

### Fase 1: aplicação utilizável com banco e fluxos completos, validada

#### Épico 1.1: regras de negócio persistentes

##### Task 1.1.1: implementar API, banco e manutenção

- **Contexto:** `tests/backend.php:4` carrega a aplicação PHP; o teste usa PDO SQLite temporário e descreve os fluxos essenciais sem framework de testes.
- **Visão de implementação:** autenticar por sessão, validar CSRF e escopo no servidor, persistir registros com transações e impedir alterações diretas de status. Cobrir envio duplicado, feedback de cliente alheio, negativa seguida de timeout, fronteira de 72 horas, conteúdo excedente e filtro que tente ampliar acesso.
- **Arquivos:** criar `src/App.php`, schemas em `database/`, `public/api.php`, `router.php` e `bin/console.php`; testar `tests/backend.php`.
- **Verificação:** `php tests/backend.php`, com falha inicial registrada antes da implementação e resultado final sem falhas; executar lint dos arquivos PHP.
- **Pronto quando:** regras e restrições são demonstradas pelo teste e requisições HTTP usam o mesmo contrato.

#### Épico 1.2: interface e fluxo operacional

##### Task 1.2.1: implementar telas integradas à API

- **Contexto:** `public/assets/cti-oficial.png` é a imagem fornecida pelo usuário. O Figma contém 23 telas; o acesso completo a algumas delas depende do limite do serviço.
- **Visão de implementação:** usar referências obtidas do Figma, implementar navegação por perfil, registro e edição compartilhados, sugestões de casos e modal de revisão. Mostrar erros reais da API e estados vazios. Evitar dados ou ações apenas decorativos. Usar confirmação rápida no portal e bloquear texto ao gravar, ou gravação ao escrever.
- **Arquivos:** criar `public/index.html`, `public/app.js` e `public/styles.css`; reutilizar `public/assets/cti-oficial.png`; testar por navegador e integração HTTP.
- **Verificação:** abrir os quatro perfis, registrar e editar atendimento, enviar solução, responder como cliente, revisar como supervisor e filtrar relatório como gestor.
- **Pronto quando:** operações persistem e são refletidas entre os perfis autorizados, com conferência visual documentada.

#### Épico 1.3: documentação e validação integrada

##### Task 1.3.1: documentar o resultado e verificar os limites

- **Contexto:** os documentos de referência não fornecem schema nem serviço de transcrição; `tests/backend.php` explicita as regras que precisam de evidência de execução.
- **Visão de implementação:** escrever o modelo real e instruções reprodutíveis, conferir respostas HTTP e o fluxo pelo navegador, registrar o que foi executado e o que permanece sem prova. Não declarar IA, transcrição, entrega de mensagem externa ou fidelidade visual sem evidência.
- **Arquivos:** criar `docs/arquitetura.md`, `docs/operacao.md` e este plano; conferir arquivos de backend e frontend sem editar arquivos de outro agente.
- **Verificação:** comparar docs com schema e rotas reais, conferir links locais e executar `rg -n '[\x{2014}\x{2013}\x{2212}]' -- docs`; código 1 significa nenhuma ocorrência.
- **Pronto quando:** comandos de operação correspondem ao código e os resultados de validação são atribuídos aos comandos realmente executados.

### Fase 2: fidelidade visual, pendente de acesso às referências

#### Épico 2.1: obter e conferir as telas pendentes

##### Task 2.1.1: implementar as seis telas a partir do contexto completo

- **Contexto:** os nós `3:2`, `4:2`, `7:2`, `13:2`, `15:2` e `21:2` do arquivo Figma não tiveram contexto completo obtido por limite do serviço. A interface funcional usa `public/app.js` e `public/styles.css`.
- **Visão de implementação:** quando o acesso retornar, obter contexto e screenshot de cada nó com a skill de design para código, comparar com as rotas existentes e corrigir geometria, tipografia e elementos visuais sem alterar as regras confirmadas pelo usuário.
- **Arquivos:** alterar `public/app.js` e `public/styles.css` somente nas telas correspondentes; consultar `public/index.html`; testar `tests/browser.mjs` e capturas da rota modificada.
- **Verificação:** executar a comparação visual de cada tela contra seu screenshot de referência e `node tests/browser.mjs`; registrar diferenças remanescentes individualmente.
- **Pronto quando:** as seis telas possuem referência completa e comparação visual aprovada, com fluxos funcionais preservados.

#### Épico 2.2: usar os assets originais

##### Task 2.2.1: obter SVGs e substituir ações sem os arquivos originais

- **Contexto:** as tentativas iniciais de exportação foram bloqueadas; na retomada de 2026-11-06, os endereços dos contextos salvos permitiram recuperar e aplicar 45 SVGs originais. Logo e fonte já são locais e foram validadas.
- **Visão de implementação:** obter os assets pelas ferramentas do Figma conforme a skill, salvar arquivos locais e aplicar cada um na posição do protótipo, sem desenhar substitutos. Conferir dimensões, proporções e leitura dos botões.
- **Arquivos:** os assets usados estão em `public/assets/figma/`, com pontos de uso em `public/app.js` e `public/styles.css`; o teste `tests/browser.mjs` e suas capturas foram atualizados após a aplicação.
- **Verificação:** conferir resposta HTTP e dimensões renderizadas dos assets, comparar screenshots com o protótipo e repetir o teste do navegador após a alteração.
- **Pronto quando:** todos os assets necessários estão locais, com posição e proporções conferidas, e nenhuma ação depende de arquivo temporário.

### Fase 3: integrações e validação operacional externa

**Épico 3.1: transcrição e análise com serviço definido.** Não implementado nesta entrega. Integrar somente após definir fornecedor, credenciais, política de tratamento dos dados e conjunto de exemplos anonimizados para medir concordância com revisão humana.

**Épico 3.2: canais externos e implantação.** Definir hospedagem, política de retenção do áudio e canal desejado antes de habilitar entrega de notificações fora do portal. A manutenção agendada precisa ser configurada no ambiente de implantação.

## Desvios

O agente principal confirmou a rodada final: `php tests/backend.php`, 65 verificações aprovadas; `node tests/http.mjs`, 21 aprovadas; `node tests/browser.mjs`, 55 aprovadas. Os três comandos terminaram com código de saída 0, totalizando 141 verificações. Os cinco arquivos PHP passaram por lint e `public/app.js` passou por `node --check`. A atualização de lembretes preservando o formulário e a recuperação de sessão sem recarregar a página também foram conferidas. As evidências, capturas e limites estão em [operação](../operacao.md).

A fase funcional foi validada e o contrato real foi registrado em [arquitetura](../arquitetura.md). O plano permanece vivo porque a reprodução visual exata ainda depende das referências e assets indisponíveis. A passagem para essa fase não deixou um caminho substituído ou arquivo obsoleto a remover; os scripts de QA e a documentação continuam úteis à conferência visual pendente.

O serviço do Figma limitou consultas antes da obtenção completa de seis telas: nós `3:2`, `4:2`, `7:2`, `13:2`, `15:2` e `21:2`. A implementação das partes sem contexto completo não poderá ser certificada como reprodução exata. Em 2026-11-06, uma nova consulta ao nó `10:2` confirmou que o bloqueio permanece. A fonte Inter possui arquivos locais. Esse limite não impede construir os fluxos funcionais.

Na retomada de 2026-11-06, os SVGs foram recuperados pelos endereços dos contextos salvos, sem novas consultas de design. Dos 57 arquivos baixados, 45 foram aplicados em posições correspondentes e 12 arquivos recém-criados sem uso foram removidos. A task 2.2.1 avançou na obtenção e aplicação; a conferência integral contra os screenshots do protótipo continua pendente junto da task 2.1.1. Os quatro perfis passaram novamente pelo teste do navegador, sem assets quebrados ou exceções de JavaScript.

A revisão também reproduziu e corrigiu o aceite de feedback após 72 horas quando não havia consulta intermediária ao portal. O teste novo falhou antes da correção, e as verificações posteriores demonstraram resposta 409, encerramento sem retorno e ausência de avaliação gravada. A rodada final teve 70 verificações de backend, 21 HTTP e 55 de navegador aprovadas, todas com saída 0. Uma revisão independente repetiu o backend sem apontar regressões concretas. As evidências atualizadas estão em [operação](../operacao.md).

## Riscos conhecidos

| Risco | Sinal de que aconteceu | O que fazer |
|---|---|---|
| Confundir ausência de retorno com satisfação | Indicador de resolvidos inclui timeout | Separar as contagens e testar o cálculo |
| Falta de manutenção agendada | Prazo expira sem atualização enquanto não há consultas ao portal | Configurar execução periódica do comando CLI de manutenção |
| Browser sem acesso ao microfone | Gravação é recusada ou indisponível | Explicar a permissão e manter texto e avaliação rápida disponíveis |
| Protótipo não acessível integralmente | Figma limita novas consultas | Registrar telas pendentes e não certificar equivalência total |
