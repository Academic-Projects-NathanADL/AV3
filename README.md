# GreenCode — Circuito Vivo (AV3)

**Passaportes circulares para eletrônicos corporativos.** O Circuito Vivo conecta a origem de um equipamento ao seu destino e mantém uma trilha de custódia que pode ser consultada pela operação ou por auditoria. Cada item recebe um código de rastreio próprio; lotes e movimentações compõem seu “passaporte circular”.

Esta é a terceira etapa do GreenCode. Sobre o servidor monolítico da AV2, a AV3 acrescenta análises operacionais e preditivas, integração pública segura para parceiros e relatórios assíncronos persistidos.

As escolhas e os trade-offs estão registrados em [`docs/relatorio-tecnico-av3.md`](docs/relatorio-tecnico-av3.md).

## O toque próprio do produto

- **Passaporte circular:** a consulta de um equipamento reúne organização geradora, lote, condição física, situação atual, destino final e quem registrou cada etapa.
- **Painel Circuito Vivo:** apresenta a fila operacional e o índice de destino circular. O índice é uma métrica interna simples — reutilizados + reciclados sobre o total cadastrado — e não uma estimativa de CO₂ ou de impacto ambiental certificado.
- **Histórias de demonstração:** Aurora Financeira, Hospital Horizonte Vivo e Instituto Aberto de Tecnologia representam fluxos diferentes de geração e destinação, tornando a apresentação menos genérica.
- **Identidade visual/API:** códigos `CV-*`, descrições de rotas orientadas à cadeia de custódia e documentação Swagger em `/docs`.

## Tecnologias e requisitos

- Node.js 20.19+ (desenvolvimento local recomendado: Node 24)
- Fastify 5, TypeScript, Prisma ORM 6.19 e PostgreSQL 16
- JWT com `@fastify/jwt`; hashes de senha com bcryptjs
- JSON Schema/TypeBox para validar e documentar os contratos HTTP
- BullMQ e Redis 7 para tarefas analíticas assíncronas com retry
- Docker Desktop com Compose (PostgreSQL na porta 5433 e Redis na 6380) ou serviços equivalentes

## Rodar localmente

Requisitos: Node.js 20.19 ou superior, npm e Docker Desktop com o mecanismo do Docker em execução. Na pasta `AV3`, copie o arquivo de ambiente se ainda não houver um `.env` local.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

No Linux/macOS, use `test -f .env || cp .env.example .env`. O `.env.example` usa a mesma URL, usuário, senha, banco, porta e Redis configurados no `docker-compose.yml`; ajuste `DATABASE_URL` ou `REDIS_URL` se usar outros serviços.

```bash
npm install
npm run db:up
npm run db:status                 # aguarde db e redis saudaveis
npm run db:deploy                 # aplica a migration que já está no projeto
npm run db:seed
npm run dev
```

`npm run dev` inicia a API; deixe esse terminal aberto. Abra um segundo terminal na pasta `AV3` e inicie `npm run worker:dev` para processar relatórios durante o desenvolvimento. Se os serviços ainda estiverem iniciando, espere e confira `npm run db:status` antes de aplicar a migration. Para diagnóstico, use `docker compose logs db` ou `docker compose logs redis`.

O servidor escuta em `http://localhost:3334`. A especificação OpenAPI e a interface interativa ficam em `http://localhost:3334/docs`; `GET /health` verifica a API, o PostgreSQL e o Redis.

Para compilar e executar a versão gerada:

```bash
npm run build
npm start              # processo da API
npm run worker         # em outro terminal, processo da fila compilado
```

Para desenvolvimento, `JWT_SECRET` deve ter pelo menos 32 caracteres. O segredo de exemplo é somente local; substitua-o fora desse ambiente. `HOST`, `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN` e `LOG_LEVEL` são configuráveis por ambiente.

### Contas de demonstração

O seed cria estas contas para apresentação local:

| Perfil | Login | Senha |
|---|---|---|
| Administrador | `admin@greencode.local` | `CircuitoVivo!2026` |
| Operador de cadastro | `operador@greencode.local` | `Operador!2026` |
| Gestor de almoxarifado | `gestor@greencode.local` | `Gestor!2026` |
| Auditor | `auditor@greencode.local` | `Auditor!2026` |

Essas credenciais são apenas dados de demonstração e não devem ser usadas em implantação real.

## Fluxo rápido da API

1. `POST /api/v1/auth/login` com `{ "login": "admin@greencode.local", "senha": "CircuitoVivo!2026" }`.
2. Envie o token retornado em `Authorization: Bearer <token>`.
3. Cadastre uma organização em `POST /api/v1/organizations` e associe seu contrato em `POST /api/v1/organizations/:id/contracts`.
4. Receba o lote com pelo menos um equipamento em `POST /api/v1/lots`; essa operação cria lote, equipamentos e movimentos de entrada numa transação.
5. Atualize a condição ou etapa em `PATCH /api/v1/equipment/:id/condition` e `PATCH /api/v1/equipment/:id/status`. Informe `versaoEsperada` para evitar sobrescrever uma alteração concorrente.
6. Consulte o passaporte em `GET /api/v1/equipment/:id/trace` e o painel em `GET /api/v1/reports/circularity`.
7. Para uma estimativa financeira, cadastre `valorAquisicaoCentavos` e `idadeMeses` no item do lote e consulte `GET /api/v1/equipment/:id/valuation`.

### Estimativa financeira

O administrador consulta `GET /api/v1/settings/financial` e atualiza os parâmetros em `PUT /api/v1/settings/financial`, enviando a versão lida:

```json
{
  "versaoEsperada": 1,
  "aliquotaImpostoBps": 600,
  "coeficienteDepreciacaoAnualBps": 2000
}
```

Os valores usam pontos-base (100 bps = 1%). O seed inicia com imposto em 0% e depreciação linear anual em 20%; o administrador deve ajustar os parâmetros à regra definida para a demonstração. No cadastro de cada equipamento, `valorAquisicaoCentavos` é informado em centavos e `idadeMeses` em meses; os dois campos são opcionais, mas precisam ser enviados juntos. A estimativa calcula o valor contábil após depreciação linear, o imposto sobre esse valor e o líquido estimado. O resultado é uma simulação operacional, não aconselhamento tributário ou avaliação contábil.

### Teste ponta a ponta no PowerShell

Com a API (`npm run dev`) e o worker (`npm run worker:dev`) iniciados em terminais separados, abra outro PowerShell na pasta `AV3`. O roteiro abaixo verifica conexão, login, permissões, estimativa financeira, recebimento de lote, triagem, rastreabilidade, validação de código de barras e conflito de versão. Ele cria um lote de demonstração adicional.

```powershell
$base = "http://localhost:3334"

# Saúde da API e do banco: deve mostrar status ok e banco conectado.
Invoke-RestMethod "$base/health"

# Login administrativo e token para as rotas protegidas.
$loginBody = @{ login = "admin@greencode.local"; senha = "CircuitoVivo!2026" } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" -ContentType "application/json" -Body $loginBody
$headers = @{ Authorization = "Bearer $($login.accessToken)" }

# O administrador ajusta os parâmetros; 600 bps = 6% e 2000 bps = 20% ao ano.
$config = Invoke-RestMethod "$base/api/v1/settings/financial" -Headers $headers
$configBody = @{ versaoEsperada = $config.versao; aliquotaImpostoBps = 600; coeficienteDepreciacaoAnualBps = 2000 } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$base/api/v1/settings/financial" -Headers $headers -ContentType "application/json" -Body $configBody

# Criar lote com equipamento de R$ 2.500,00 e 24 meses de idade.
$organizacoes = Invoke-RestMethod "$base/api/v1/organizations" -Headers $headers
$loteBody = @{
  organizacaoId = $organizacoes[0].id
  notaFiscal = "NF-TESTE-README"
  transportadora = "Transportadora de teste"
  dataEntrada = (Get-Date).ToString("yyyy-MM-dd")
  equipamentos = @(@{ tipo = "NOTEBOOK"; estadoFisico = "BOM"; valorAquisicaoCentavos = 250000; idadeMeses = 24 })
} | ConvertTo-Json -Depth 10
$lote = Invoke-RestMethod -Method Post -Uri "$base/api/v1/lots" -Headers $headers -ContentType "application/json" -Body $loteBody
$equipamento = $lote.equipamentos[0]

# Esperado: valor contabil 150000, imposto 9000 e valor liquido 141000 (centavos).
Invoke-RestMethod "$base/api/v1/equipment/$($equipamento.id)/valuation" -Headers $headers

# O auditor pode ler o painel, mas nao pode alterar parametros (esperado: HTTP 403).
$auditorBody = @{ login = "auditor@greencode.local"; senha = "Auditor!2026" } | ConvertTo-Json
$auditorLogin = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" -ContentType "application/json" -Body $auditorBody
$auditorHeaders = @{ Authorization = "Bearer $($auditorLogin.accessToken)" }
Invoke-RestMethod "$base/api/v1/reports/circularity" -Headers $auditorHeaders
$bloqueioBody = @{ versaoEsperada = 1; aliquotaImpostoBps = 600; coeficienteDepreciacaoAnualBps = 2000 } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Put -Uri "$base/api/v1/settings/financial" -Headers $auditorHeaders -ContentType "application/json" -Body $bloqueioBody
  Write-Host "FALHA: o auditor conseguiu alterar os parametros."
} catch {
  Write-Host "HTTP esperado 403; recebido $([int]$_.Exception.Response.StatusCode)."
}

# Triar sem codigo de barras deve retornar HTTP 400 e nao alterar o equipamento.
$equipamentos = Invoke-RestMethod "$base/api/v1/equipment" -Headers $headers
$pendente = @($equipamentos | Where-Object status -eq "AGUARDANDO_TRIAGEM" | Select-Object -First 1)[0]
$semCodigoBody = @{ versaoEsperada = $pendente.versao; novoStatus = "TRIADO" } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Patch -Uri "$base/api/v1/equipment/$($pendente.id)/status" -Headers $headers -ContentType "application/json" -Body $semCodigoBody
  Write-Host "FALHA: a triagem sem codigo foi aceita."
} catch {
  Write-Host "HTTP esperado 400; recebido $([int]$_.Exception.Response.StatusCode)."
}
(Invoke-RestMethod "$base/api/v1/equipment/$($pendente.id)/trace" -Headers $headers).situacao

# Triagem valida e consulta da trilha de custodia.
$codigoBarras = "BC-README-$(Get-Random -Minimum 100000 -Maximum 999999)"
$triagemBody = @{ versaoEsperada = $equipamento.versao; novoStatus = "TRIADO"; codigoBarras = $codigoBarras } | ConvertTo-Json
$triado = Invoke-RestMethod -Method Patch -Uri "$base/api/v1/equipment/$($equipamento.id)/status" -Headers $headers -ContentType "application/json" -Body $triagemBody
Invoke-RestMethod "$base/api/v1/equipment/$($equipamento.id)/trace" -Headers $headers

# A mesma alteracao com versao antiga deve retornar HTTP 409 e manter status TRIADO.
$conflitoBody = @{ versaoEsperada = $triado.versao - 1; novoStatus = "RECICLADO"; destinoFinal = "Teste de concorrencia" } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Patch -Uri "$base/api/v1/equipment/$($equipamento.id)/status" -Headers $headers -ContentType "application/json" -Body $conflitoBody
  Write-Host "FALHA: a versao antiga foi aceita."
} catch {
  Write-Host "HTTP esperado 409; recebido $([int]$_.Exception.Response.StatusCode)."
}
(Invoke-RestMethod "$base/api/v1/equipment/$($equipamento.id)/trace" -Headers $headers).situacao
```

Nos erros esperados, confira o número HTTP impresso pelo `catch`. No último estado, o item deve permanecer `TRIADO` com a mesma versão devolvida pela triagem válida. Se o PowerShell indicar erro de `Content-Length`, mantenha textos ASCII nos corpos JSON de teste (sem acentos). O mesmo fluxo também pode ser feito manualmente pela interface Swagger em `/docs`.

## Relatórios analíticos

O módulo mantém três análises independentes, disponíveis para a organização vinculada à chave:

| Rota | O que calcula |
|---|---|
| `GET /api/v1/public/v1/analytics/efficiency` | Média de horas da entrada do lote até a primeira triagem concluída, com recortes por operador e mês. |
| `GET /api/v1/public/v1/analytics/profitability` | Recuperação estimada média e total, agrupadas por tipo, condição física, marca e modelo. |
| `GET /api/v1/public/v1/analytics/useful-life` | Projeção exploratória em meses até condição inservível por regressão linear dos níveis de desgaste observados. |

Os valores de recuperação, marca, modelo e idade são capturados no cadastro do lote. Uma observação de condição e depreciação é gravada no recebimento e em cada alteração de condição; pioras são contabilizadas como eventos de falha/degradação. A previsão considera essas observações e idades, e cada resultado informa tamanho da amostra, R² e quando não há dados suficientes. É uma estimativa acadêmica exploratória, não uma promessa de vida útil.

## API pública para parceiros

Todas as rotas públicas ficam isoladas em `/api/v1/public/v1`. Elas usam o cabeçalho `X-API-Key`, têm limite de 120 requisições por minuto por chave e só acessam os dados da organização associada à credencial.

Um administrador gera e revoga credenciais autenticado por JWT:

- `POST /api/v1/internal/api-keys`: cria uma chave; o segredo completo aparece uma única vez na resposta.
- `GET /api/v1/internal/api-keys`: lista metadados, sem retornar segredos ou hashes.
- `PATCH /api/v1/internal/api-keys/:id/revoke`: revoga a chave.

Exemplo de criação:

```json
{
  "nome": "Parceiro Aurora",
  "organizacaoId": "UUID_DA_ORGANIZACAO",
  "permissoes": ["TRACE_READ", "LOTS_READ", "LOTS_WRITE", "ANALYTICS_READ"]
}
```

Permissões disponíveis: `TRACE_READ`, `LOTS_READ`, `LOTS_WRITE` e `ANALYTICS_READ`. O parceiro consulta `GET /api/v1/public/v1/trace/:codigoRastreio` e `GET /api/v1/public/v1/lots`; para receber lotes, envia `POST /api/v1/public/v1/lots` sem `organizacaoId` — a organização vem da chave. Os escopos são validados em cada rota e a consulta de passaporte verifica a organização.

Exemplo PowerShell: crie a chave usando o token JWT do administrador e chame as rotas públicas com ela:

```powershell
$base = "http://localhost:3334"
$loginBody = @{ login = "admin@greencode.local"; senha = "CircuitoVivo!2026" } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" -ContentType "application/json" -Body $loginBody
$headers = @{ Authorization = "Bearer $($login.accessToken)" }
$organizacoes = Invoke-RestMethod "$base/api/v1/organizations" -Headers $headers
$chaveBody = @{ nome = "Parceiro Aurora"; organizacaoId = $organizacoes[0].id; permissoes = @("TRACE_READ", "LOTS_READ", "ANALYTICS_READ") } | ConvertTo-Json
$integracao = Invoke-RestMethod -Method Post -Uri "$base/api/v1/internal/api-keys" -Headers $headers -ContentType "application/json" -Body $chaveBody
# Guarde $integracao.apiKey: a resposta futura da listagem nao mostra o segredo.
$parceiroHeaders = @{ "X-API-Key" = $integracao.apiKey }
Invoke-RestMethod "$base/api/v1/public/v1/lots" -Headers $parceiroHeaders
Invoke-RestMethod "$base/api/v1/public/v1/analytics/efficiency" -Headers $parceiroHeaders
Invoke-RestMethod "$base/api/v1/public/v1/analytics/profitability" -Headers $parceiroHeaders
Invoke-RestMethod "$base/api/v1/public/v1/analytics/useful-life" -Headers $parceiroHeaders

# Solicite o pacote assíncrono; acompanhe até CONCLUIDO ou FALHOU.
$solicitacao = Invoke-RestMethod -Method Post -Uri "$base/api/v1/public/v1/analytics/reports" -Headers $parceiroHeaders -ContentType "application/json" -Body "{}"
$estadoRelatorio = $null
for ($tentativa = 0; $tentativa -lt 30; $tentativa++) {
  $estadoRelatorio = Invoke-RestMethod "$base$($solicitacao.links.status)" -Headers $parceiroHeaders
  if ($estadoRelatorio.status -in @("CONCLUIDO", "FALHOU")) { break }
  Start-Sleep -Seconds 1
}
$estadoRelatorio
if ($estadoRelatorio.status -eq "CONCLUIDO") {
  Invoke-RestMethod "$base$($solicitacao.links.download)?formato=json" -Headers $parceiroHeaders
  Invoke-WebRequest "$base$($solicitacao.links.download)?formato=csv" -Headers $parceiroHeaders -OutFile "relatorio-analytics.csv"
}
```

## Relatórios assíncronos

Para solicitar o pacote completo de análises, envie `POST /api/v1/public/v1/analytics/reports` com `X-API-Key` de escopo `ANALYTICS_READ` e sem corpo. A API responde `202 Accepted` com o identificador e links. Consulte `GET /api/v1/public/v1/analytics/reports/:id` até o estado ser `CONCLUIDO`; então baixe JSON em `/download?formato=json` ou CSV em `/download?formato=csv`.

O processo requer dois terminais: API (`npm run dev`) e worker (`npm run worker:dev`) em desenvolvimento. Depois de `npm run build`, use `npm start` e `npm run worker` em produção. BullMQ mantém a fila no Redis; falhas são repetidas até três vezes com espera exponencial de 2 segundos. O estado, resultado, tentativas e erro final permanecem na tabela `relatorios_analiticos`, inclusive após remoção posterior do job concluído da fila. Um `409` no download significa que o relatório ainda está processando; `404` indica id inexistente ou fora do escopo da chave.

As requisições públicas, autenticação de chave, parâmetros, exemplos e respostas de erro também estão na interface OpenAPI em `/docs`, separadas pela tag `API pública v1`.

Exemplo de transição de triagem:

```json
{
  "versaoEsperada": 1,
  "novoStatus": "TRIADO",
  "codigoBarras": "BC-2026-00918"
}
```

O equipamento precisa completar a triagem antes de ser encaminhado para desmontagem. Para concluir o passaporte, informe um destino final em estados como `REUTILIZADO`, `RECICLADO` ou `DESCARTE_SEGURO`.

## Perfis e acesso

| Perfil | Pode fazer |
|---|---|
| Administrador | Contas, parâmetros de acesso e todas as operações |
| Operador de cadastro | Organizações e contratos; consulta operacional |
| Gestor de almoxarifado | Recebimento de lotes, triagem, condições e destinos |
| Auditor | Consultas de rastreabilidade e painel; sem alterações |

As rotas internas exigem JWT; as rotas públicas exigem uma chave de API com escopo suficiente. A organização da credencial é verificada no servidor em cada consulta.

## Arquitetura

```text
HTTP + JSON Schema
        ↓
Routes / Controllers (Fastify)
        ↓
Services (validação e regras de negócio)
        ↓
Repositories (Prisma Client)
        ↓
PostgreSQL
```

- **Controllers/routes:** definem contratos HTTP, validação estrutural, autenticação e delegação.
- **Services:** aplicam CNPJ, janela de 90 dias, permissões e regras do ciclo circular.
- **Repositories:** concentram as consultas e escritas Prisma.
- **Prisma:** modelo relacional, chaves estrangeiras, índices, unicidade e migrations versionadas.

### Transações e concorrência

Receber um lote com seus equipamentos e movimentos usa uma transação Prisma. Mudar estado ou condição do equipamento grava a atualização e sua movimentação na mesma transação; se uma falhar, nenhuma é confirmada. Cada modelo tem `versao`. Nas atualizações concorrentes, o `UPDATE` exige o ID e a versão lida (`updateMany` com `versao` esperada) e incrementa a versão; conflito retorna HTTP 409 para o cliente recarregar antes de tentar novamente.

### Segurança

- Senhas são armazenadas com bcryptjs e fator de custo 12; nunca são incluídas nas respostas.
- JWT HS256 carrega somente identificador, login e perfil, com validade configurável (padrão: 30 minutos).
- Login tem limite de tentativas por IP; chamadas são limitadas por IP ou chave pública; logs redigem Authorization, X-API-Key e senha.
- Helmet aplica cabeçalhos HTTP de segurança; CORS é configurável.
- O segredo JWT precisa ser substituído por um valor aleatório fora de desenvolvimento.

## Dados e migrations

O seed é idempotente e cria quatro perfis, organizações de demonstração, contratos, lotes e equipamentos em etapas distintas do ciclo. Para evoluir o schema, edite `prisma/schema.prisma` e gere uma migration com `npm run db:migrate -- --name descricao-da-alteracao`. Em implantação, aplique migrations existentes com `npm run db:deploy`.

O seed demonstra a nova base relacional; a importação de dados reais dos arquivos da AV1 exigiria um exportador de cada `.enc` usando a chave mestra original. Como essa chave não deve ser copiada para o repositório, essa migração deve ser executada no ambiente que possui os dados e a chave.

## Estrutura

```text
prisma/schema.prisma      modelos, enums e relações
prisma/seed.ts            massa de demonstração idempotente
src/routes/               contratos internos, administração de chaves e API pública
src/services/             regras de negócio
src/repositories/          acesso Prisma e transações
src/plugins/auth.ts       JWT e autorização por perfil
src/plugins/api-key-auth.ts validação de chave, escopo e organização
src/analytics/             eficiência, recuperação e vida útil
src/queues/                fila BullMQ e conexão Redis
src/workers/               execução e retry de relatórios
src/server.ts              Fastify, OpenAPI, rate limit e graceful shutdown
docs/relatorio-tecnico-av3.md decisões, métodos, retry e evolução
```
