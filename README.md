# Desafio de Ideias

Projeto integrador do curso Técnico em Desenvolvimento de Sistemas da Escola SENAI "A. Jacob Lafer" (Santo André, 2026).

**Demanda escolhida:** Projeto Integrador 2025/02 1.34_16, *Sistema de análise e monitoramento de feedbacks para melhoria da experiência do cliente*.

## O problema

Os feedbacks dos clientes de uma equipe de suporte estão espalhados: tickets escritos ficam na plataforma de atendimento e as gravações das chamadas (MP3 e WAV) ficam em outro armazenamento. Analistas de qualidade leem e ouvem tudo na mão, o que gera:

- demora para perceber o estado emocional do cliente e priorizar casos críticos;
- ações corretivas tardias, com risco de perda de clientes;
- retrabalho para cruzar informações de sistemas diferentes;
- falta de indicadores consolidados para a gestão.

Volume informado pela empresa: cerca de 200 tickets e 100 chamadas gravadas por dia (média de 6 minutos por chamada).

## A solução proposta

Plataforma web centralizada que reúne tickets e chamadas, transcreve o áudio automaticamente (Speech-to-Text), classifica o sentimento (positivo, neutro ou negativo, com nível de confiança) e destaca os casos críticos em um painel único.

Pontos definidos na entrevista com a empresa:

- **Perfis:** Atendente (vê os próprios atendimentos), Supervisor (acompanha a equipe e trata alertas) e Gestor (indicadores gerais, histórico e comparação entre equipes).
- **MVP sem integrações externas:** tickets e áudios entram direto na plataforma.
- **IA apoia, não decide:** casos críticos vão para análise humana.
- **LGPD:** acesso restrito por perfil, dados anonimizados ou mascarados e retenção de 12 meses para transcrições e análises.

## Estrutura do repositório

```
desafio_de_ideias/
├── README.md
└── docs/
    ├── 01-ideia-geral/      respostas iniciais do grupo sobre demanda, problema e ideia
    ├── 02-planejamento/     cronograma do desafio (etapas, entregáveis e status por grupo)
    ├── 03-entrevista/       retorno da empresa ao roteiro de entrevista exploratória
    ├── 04-matriz-csd/       Matriz CSD (certezas, suposições e dúvidas)
    └── 05-relatorio/        relatório do projeto (resumo, problematização e proposta)
```

A numeração das pastas segue a ordem em que o material é produzido no cronograma.

## Executar o CTI Escuta

Para a demonstração hospedada com Gemini por API, siga o [guia de hospedagem](docs/hospedagem.md).
Ele descreve a criação das contas, a transferência dos arquivos, a configuração
privada, o HTTPS e a aceitação com um texto e um áudio curto. O [brief de publicação
com Claude Code e Claude in Chrome](docs/publicar-com-claude.md) orienta a automação
dessas etapas, com intervenção do usuário em login, permissões e eventual pagamento.

Esse modo usa PHP e SQLite, dispensa modelos locais e processa um feedback por
solicitação. O teto inicial é de 20 tentativas por instalação, sem repetição
automática após falha; resultados concluídos são reaproveitados. A análise Gemini
preserva a revisão humana e não apresenta uma porcentagem de confiança inventada.
Os testes locais usam respostas simuladas e não consomem a API. Publicação, contas,
HTTPS remoto e inferência real ainda precisam de validação. Veja o [estado atual](docs/estado-atual.md)
e o [plano da demonstração](docs/plano-demo-hospedada.md).

Os comandos abaixo correspondem ao modo local anterior.

A aplicação usa PHP 8.4 com `PDO`, `pdo_sqlite` e `mbstring`, Node.js 20 ou superior e npm. No PowerShell, abra a pasta do repositório e execute:

```powershell
.\iniciar.ps1
```

O sistema abre em `http://localhost:8080`, com o processamento de IA e transcrição em segundo plano. Na primeira execução, o script instala as dependências e baixa os modelos locais; essa preparação precisa de internet. Depois, a inferência funciona localmente, sem chave de API paga.

Os acessos de demonstração aparecem na tela de login. Banco, gravações, modelos e dependências instaladas ficam fora do versionamento. Consulte [operação e validação](docs/operacao.md) para os comandos de teste, configuração e limites, e [arquitetura](docs/arquitetura.md) para o modelo de dados e os fluxos.

## Documentos

| Pasta | Arquivo | Conteúdo |
|---|---|---|
| 01 | [Ideia-geral.pdf](docs/01-ideia-geral/Ideia-geral.pdf) | Demanda, problema, importância e ideia inicial |
| 02 | [Cronograma-2026.pdf](docs/02-planejamento/Cronograma-2026.pdf) | Etapas de 03/09/2026 até a entrega final da 1ª fase |
| 03 | [Retorno-Roteiro-Entrevista-GR2.pdf](docs/03-entrevista/Retorno-Roteiro-Entrevista-GR2.pdf) | 20 perguntas e respostas da empresa |
| 04 | [Matriz-CSD-2026-10-08.png](docs/04-matriz-csd/Matriz-CSD-2026-10-08.png) | Matriz CSD de 08/10/2026 |
| 05 | [Relatorio-Desafio-de-Ideias.pdf](docs/05-relatorio/Relatorio-Desafio-de-Ideias.pdf) | Relatório com resumo e abstract |

Sobre o que acontece quando o volume de registros crescer, com números medidos e os degraus de evolução, leia [escalabilidade](docs/escalabilidade.md).

## Andamento

Etapas 1 a 4 (abertura, seleção da demanda, imersão e preparação da entrevista) estão concluídas no cronograma. A etapa 5 (validação com a indústria) está em andamento. Seguem: atualização da Matriz CSD, ideação, seleção da solução, protótipo V1 e V2 e entrega final da 1ª fase. Não é exigido software funcional nesta fase.

## Equipe

- Mariana Felipe Nascimento
- Vinicius Vila Nova
- Eduardo Zanetti Luis
- Giovana Alves
- Gustavo Henrique Barreto
- Mariana Chaves Ribeiro
- Rafael Brecci de Souza
- Vitor Matheus Canalli
- Nicolas Fernandes 

**Orientadores:** Prof. Paulo Cesar.

## Como organizar novos arquivos

- Um arquivo novo vai na pasta da etapa a que pertence; se a etapa ainda não tem pasta, crie a próxima numeração (`06-ideacao`, `07-prototipo`, e assim por diante).
- Nomes sem espaços e sem versão no nome (`(1)`, `(3)`): troque o arquivo e deixe o histórico do Git guardar as versões antigas.
- Prefira PDF para documento final e PNG para imagem de matriz ou diagrama.
