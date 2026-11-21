# Relatório técnico — AV3 GreenCode Circuito Vivo

## Objetivo e contexto

A AV3 evolui o monólito da AV2 com três capacidades: transformar dados operacionais em métricas, disponibilizar contratos públicos versionados para parceiros e processar pacotes analíticos demorados sem manter uma requisição HTTP aberta. O escopo continua no domínio da logística reversa de eletrônicos; a integração pública não substitui as rotas internas autenticadas por JWT.

## Arquitetura analítica

`AnalyticsService` mantém três cálculos independentes e sem estado compartilhado: eficiência operacional, rentabilidade estimada e vida útil remanescente. Cada serviço também pode responder diretamente a uma rota pública de leitura, enquanto `pacoteCompleto` compõe os três para execução assíncrona.

### Eficiência operacional

Para cada equipamento, seleciona-se a primeira movimentação `TRIAGEM` que conclui em `TRIADO`. O tempo é a diferença entre `dataEntrada` do lote e `ocorridoEm` da triagem, em horas. A resposta agrega média geral, operador responsável e mês da triagem. Eventos fora de ordem ou anteriores à entrada são ignorados. A métrica começa no recebimento registrado no lote, não no transporte ou na retirada na empresa geradora.

### Rentabilidade estimada

O cadastro aceita `valorRecuperacaoEstimadoCentavos`, marca e modelo. Os valores são agrupados por tipo, estado físico, marca e modelo; a API retorna média, total e tamanho da amostra em cada grupo. Os dados são estimativas operacionais informadas no recebimento, não valores de venda já realizados nem lucro líquido. Usar centavos evita erros de arredondamento em moeda.

### Vida útil remanescente

Cada estado físico recebe um escore ordinal: excelente=0, bom=1, regular=2, ruim=3 e inservível=4. `ObservacaoCondicao` registra estado e idade, valor contábil, depreciação acumulada, origem e se a mudança representou piora. É gravada no recebimento e dentro da mesma transação que altera a condição física. Por tipo, o serviço ajusta modelos de mínimos quadrados ordinários entre escore e idade e, quando há valores suficientes, entre escore e percentual de depreciação acumulada. Converte a depreciação projetada para idade por sua regressão observada contra idade, estima o ponto de escore 4 e subtrai a idade média atual. A resposta informa amostra, eventos de falha/degradação, R² e método; com poucos pontos ou sem inclinação crescente, não apresenta um número inventado.

Esse modelo simples foi escolhido por ser explicável, reproduzível e não exigir treinamento externo. Ele é sensível à qualidade e à representatividade dos dados, e a relação ordinal linear é uma hipótese de demonstração. Produção exigiria validação retrospectiva, intervalos de confiança, tratamento de censura e comparação com suavização exponencial ou modelos de sobrevivência.

## Persistência dos relatórios

`RelatorioAnalitico` armazena UUID, tipo, organização, chave solicitante, estados, horários, tentativas, erro final e resultado JSON. `ObservacaoCondicao` mantém o histórico analítico de desgaste e depreciação por equipamento. O registro de relatório é criado antes de publicar o job; o UUID é reutilizado como identificador do job BullMQ. Isso oferece um histórico consultável pelo parceiro depois que o job sai da fila. O resultado completo fica no PostgreSQL, que já é a fonte transacional do produto.

As transições são `PENDENTE → PROCESSANDO → CONCLUIDO` ou `PENDENTE/PROCESSANDO → FALHOU`. O worker usa três tentativas no máximo com backoff exponencial inicial de dois segundos. A última falha grava mensagem sanitizada e estado terminal. Uma queda entre a gravação no banco e a publicação na fila é marcada como falha e fica visível ao cliente; uma evolução futura pode trocar isso por transactional outbox para eliminar essa janela.

## API pública e chaves

As rotas de parceiros ficam em `/api/v1/public/v1`, separadas das rotas internas `/api/v1`. Administradores geram chaves por organização e atribuem escopos (`TRACE_READ`, `LOTS_READ`, `LOTS_WRITE`, `ANALYTICS_READ`). A chave completa é exibida somente na criação. O banco guarda prefixo indexado e SHA-256 do segredo aleatório; a comparação do hash usa `timingSafeEqual`. Chaves podem ser revogadas sem apagar a trilha histórica.

Cada consulta filtra pela organização da chave. A trilha registra a chave como ator de movimentações escritas por parceiro. O limite global do Fastify usa IP para clientes comuns e hash da chave para a API pública, com 120 requisições por minuto. `/docs` descreve autenticação, exemplos e respostas de erro.

## Alternativas e evolução

Escolhemos BullMQ com Redis porque a requisição de pacote retorna `202` rapidamente e a fila oferece persistência de jobs e política de retry. Executar tudo inline seria mais simples, mas exporia o cliente a timeout e ocuparia conexões HTTP enquanto relatórios maiores fossem calculados. Um processo worker separado mantém o domínio modular sem introduzir microsserviços.

Para centenas ou milhares de parceiros, a evolução inclui: transactional outbox; Redis e PostgreSQL gerenciados com alta disponibilidade; workers escalados por fila e limite por organização; materialized views ou partições temporais para movimentos; retenção e exportação de relatórios; métricas de lag, falha, duração e custo por job; rotação de chaves e limites por plano; e versionamento de contratos com janela de depreciação. As rotas públicas hoje permanecem na versão `v1` independentemente da versão interna.

## Execução e demonstração

PostgreSQL, Redis, API e worker são separados no Docker Compose. O guia de inicialização, permissões, criação de chaves e exemplos de integração está no [`README.md`](../README.md). A seed inclui amostras de recuperação e idades variadas para exercitar agrupamentos e regressão. Os números de demonstração não devem ser apresentados como previsões comerciais validadas.
