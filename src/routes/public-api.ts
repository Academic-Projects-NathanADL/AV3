import { EstadoFisico, TipoEquipamento } from "@prisma/client";
import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { AnalyticsService } from "../analytics/analytics-service";
import { AnalyticsReportService } from "../services/analytics-report-service";
import { LotService } from "../services/lot-service";
import { EquipmentService } from "../services/equipment-service";
import { notFound } from "../shared/errors";
import { prisma } from "../shared/prisma";

const TraceParams = Type.Object({ codigoRastreio: Type.String({ minLength: 3, maxLength: 32 }) });
const ReportParams = Type.Object({ id: Type.String({ format: "uuid" }) });
const DownloadQuery = Type.Object({ formato: Type.Optional(Type.Union([Type.Literal("json"), Type.Literal("csv")], { default: "json" })) });
const ApiErrorResponse = Type.Object({ erro: Type.Object({ codigo: Type.String(), mensagem: Type.String(), requisicao: Type.String() }) });
const ApiErrors = { 400: ApiErrorResponse, 401: ApiErrorResponse, 403: ApiErrorResponse, 404: ApiErrorResponse, 409: ApiErrorResponse, 429: ApiErrorResponse, 500: ApiErrorResponse };
const EquipmentInput = Type.Object({
  tipo: Type.Enum(TipoEquipamento),
  estadoFisico: Type.Enum(EstadoFisico),
  marca: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  modelo: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  valorRecuperacaoEstimadoCentavos: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000000000 })),
  valorAquisicaoCentavos: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000000000 })),
  idadeMeses: Type.Optional(Type.Integer({ minimum: 0, maximum: 1200 })),
}, { additionalProperties: false });
const PublicLotBody = Type.Object({
  notaFiscal: Type.String({ minLength: 1, maxLength: 60 }),
  transportadora: Type.String({ minLength: 2, maxLength: 120 }),
  dataEntrada: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  equipamentos: Type.Array(EquipmentInput, { minItems: 1, maxItems: 250 }),
}, { additionalProperties: false, examples: [{ notaFiscal: "NF-PARCEIRO-2026-001", transportadora: "Ciclo Norte", dataEntrada: "2026-11-16", equipamentos: [{ tipo: "NOTEBOOK", estadoFisico: "BOM", marca: "Dell", modelo: "Latitude 5420", valorRecuperacaoEstimadoCentavos: 120000 }] }] });
type PublicLotBody = Static<typeof PublicLotBody>;

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function analyticsCsv(data: Record<string, unknown>): string {
  const rows: unknown[][] = [["secao", "tipo", "estado", "marca", "modelo", "amostras", "media", "total", "meses_restantes", "status", "detalhe"]];
  const efficiency = data.eficienciaOperacional as Record<string, unknown> | undefined;
  if (efficiency) rows.push(["eficiencia", "", "", "", "", efficiency.equipamentoTriados, efficiency.mediaHorasEntradaAteTriagem, "", "", "", efficiency.criterio]);
  const profitability = data.rentabilidadePorEquipamento as Record<string, unknown> | undefined;
  for (const item of (profitability?.porTipoEstadoMarcaModelo as Array<Record<string, unknown>> | undefined) ?? []) {
    rows.push(["rentabilidade", item.tipo, item.estadoFisico, item.marca, item.modelo, item.amostras, item.mediaRecuperacaoCentavos, item.totalEstimadoCentavos, "", "", ""]);
  }
  const life = data.vidaUtilRemanescente as Record<string, unknown> | undefined;
  for (const item of (life?.previsoes as Array<Record<string, unknown>> | undefined) ?? []) {
    rows.push(["vida_util", item.tipo, "", "", "", item.observacoesHistoricas, "", "", item.vidaUtilRemanescenteMediaMeses, item.status, `R2=${item.r2}`]);
  }
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export async function publicApiRoutes(app: FastifyInstance) {
  const analytics = new AnalyticsService();
  const reports = new AnalyticsReportService();
  const lotService = new LotService();
  const equipmentService = new EquipmentService();
  const key = app.authenticateApiKey;
  const permission = app.requireApiPermission;
  const apiKeySecurity = [{ apiKeyAuth: [] }];

  app.get<{ Params: Static<typeof TraceParams> }>("/public/v1/trace/:codigoRastreio", {
    preHandler: [key, permission("TRACE_READ")],
    schema: { tags: ["API pública v1"], summary: "Consultar passaporte por código de rastreio dentro da organização da chave", security: apiKeySecurity, params: TraceParams, response: { 200: Type.Any({ description: "Passaporte e trilha de custodia" }), ...ApiErrors } },
  }, async (request) => {
    const item = await prisma.equipamento.findFirst({
      where: { codigoRastreio: request.params.codigoRastreio, lote: { is: { organizacaoId: request.apiClient!.organizacaoId } } },
      select: { id: true },
    });
    if (!item) throw notFound("Equipamento");
    return equipmentService.trace(item.id);
  });

  app.get("/public/v1/lots", {
    preHandler: [key, permission("LOTS_READ")],
    schema: { tags: ["API pública v1"], summary: "Listar lotes da organização da chave", security: apiKeySecurity, response: { 200: Type.Array(Type.Any()), ...ApiErrors } },
  }, (request) => prisma.lote.findMany({
    where: { organizacaoId: request.apiClient!.organizacaoId },
    include: { _count: { select: { equipamentos: true } } },
    orderBy: { dataEntrada: "desc" },
  }));

  app.post<{ Body: PublicLotBody }>("/public/v1/lots", {
    preHandler: [key, permission("LOTS_WRITE")],
    schema: { tags: ["API pública v1"], summary: "Submeter lote em nome da organização vinculada a chave", security: apiKeySecurity, body: PublicLotBody, response: { 201: Type.Any({ description: "Lote recebido com os equipamentos criados" }), ...ApiErrors } },
  }, async (request, reply) => reply.code(201).send(await lotService.create({
    ...request.body,
    organizacaoId: request.apiClient!.organizacaoId,
    chaveApiId: request.apiClient!.id,
  })));

  app.get("/public/v1/analytics/efficiency", {
    preHandler: [key, permission("ANALYTICS_READ")],
    schema: { tags: ["API pública v1"], summary: "Métricas de tempo entre entrada e triagem", security: apiKeySecurity, response: { 200: Type.Any(), ...ApiErrors } },
  }, (request) => analytics.eficienciaOperacional(request.apiClient!.organizacaoId));
  app.get("/public/v1/analytics/profitability", {
    preHandler: [key, permission("ANALYTICS_READ")],
    schema: { tags: ["API pública v1"], summary: "Recuperação média agrupada por tipo, condição, marca e modelo", security: apiKeySecurity, response: { 200: Type.Any(), ...ApiErrors } },
  }, (request) => analytics.rentabilidadePorEquipamento(request.apiClient!.organizacaoId));
  app.get("/public/v1/analytics/useful-life", {
    preHandler: [key, permission("ANALYTICS_READ")],
    schema: { tags: ["API pública v1"], summary: "Previsão exploratória de vida útil por regressão linear", security: apiKeySecurity, response: { 200: Type.Any(), ...ApiErrors } },
  }, (request) => analytics.vidaUtilRemanescente(request.apiClient!.organizacaoId));

  app.post("/public/v1/analytics/reports", {
    preHandler: [key, permission("ANALYTICS_READ")],
    schema: {
      tags: ["API pública v1"], summary: "Enfileirar pacote analítico assíncrono", security: apiKeySecurity,
      description: "Envie a chave em X-API-Key; nao ha corpo na solicitacao.",
      response: {
        202: Type.Object({ id: Type.String({ format: "uuid" }), status: Type.String(), solicitadoEm: Type.String(), links: Type.Object({ status: Type.String(), download: Type.String() }) }, { examples: [{ id: "70ab9b94-8e0d-4d5c-b282-e45b1125b071", status: "PENDENTE", solicitadoEm: "2026-11-16T12:00:00.000Z", links: { status: "/api/v1/public/v1/analytics/reports/70ab9b94-8e0d-4d5c-b282-e45b1125b071", download: "/api/v1/public/v1/analytics/reports/70ab9b94-8e0d-4d5c-b282-e45b1125b071/download" } }] }),
        ...ApiErrors,
      },
    },
  }, async (request, reply) => reply.code(202).send(await reports.request(request.apiClient!.organizacaoId, request.apiClient!.id)));

  app.get<{ Params: Static<typeof ReportParams> }>("/public/v1/analytics/reports/:id", {
    preHandler: [key, permission("ANALYTICS_READ")],
    schema: { tags: ["API pública v1"], summary: "Consultar estado e tentativas do relatório", security: apiKeySecurity, params: ReportParams, response: { 200: Type.Any(), ...ApiErrors } },
  }, (request) => reports.status(request.params.id, request.apiClient!.id, request.apiClient!.organizacaoId));

  app.get<{ Params: Static<typeof ReportParams>; Querystring: Static<typeof DownloadQuery> }>("/public/v1/analytics/reports/:id/download", {
    preHandler: [key, permission("ANALYTICS_READ")],
    schema: { tags: ["API pública v1"], summary: "Baixar resultado analítico como JSON ou CSV", security: apiKeySecurity, params: ReportParams, querystring: DownloadQuery, response: { 200: Type.Any({ description: "Resultado JSON ou arquivo CSV" }), ...ApiErrors } },
  }, async (request, reply) => {
    const result = await reports.result(request.params.id, request.apiClient!.id, request.apiClient!.organizacaoId);
    const data = result.resultado as Record<string, unknown>;
    if ((request.query.formato ?? "json") === "csv") {
      return reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="relatorio-${result.id}.csv"`).send(analyticsCsv(data));
    }
    return reply.send(result);
  });
}
