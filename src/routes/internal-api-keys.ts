import { Papel } from "@prisma/client";
import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { ApiKeyService } from "../services/api-key-service";

const Permission = Type.Union([
  Type.Literal("TRACE_READ"), Type.Literal("LOTS_READ"), Type.Literal("LOTS_WRITE"), Type.Literal("ANALYTICS_READ"),
]);
const CreateKeyBody = Type.Object({
  nome: Type.String({ minLength: 2, maxLength: 100 }),
  organizacaoId: Type.String({ format: "uuid" }),
  permissoes: Type.Array(Permission, { minItems: 1, uniqueItems: true }),
}, { additionalProperties: false, examples: [{ nome: "Parceiro Aurora", organizacaoId: "70ab9b94-8e0d-4d5c-b282-e45b1125b071", permissoes: ["TRACE_READ", "LOTS_READ", "ANALYTICS_READ"] }] });
type CreateKeyBody = Static<typeof CreateKeyBody>;
const KeyParams = Type.Object({ id: Type.String({ format: "uuid" }) });

export async function internalApiKeyRoutes(app: FastifyInstance) {
  const service = new ApiKeyService();
  const admin = app.authorize([Papel.ADMINISTRADOR]);
  app.get("/internal/api-keys", {
    preHandler: [admin],
    schema: { tags: ["Integrações internas"], summary: "Listar metadados das chaves de API", security: [{ bearerAuth: [] }] },
  }, () => service.list());
  app.post<{ Body: CreateKeyBody }>("/internal/api-keys", {
    preHandler: [admin],
    schema: {
      tags: ["Integrações internas"], summary: "Criar chave de API pública vinculada a organização; segredo exibido somente nesta resposta", security: [{ bearerAuth: [] }], body: CreateKeyBody,
      response: { 201: Type.Object({ id: Type.String({ format: "uuid" }), nome: Type.String(), prefixo: Type.String(), permissoes: Type.Array(Type.String()), organizacaoId: Type.String(), ativa: Type.Boolean(), criadoEm: Type.String(), apiKey: Type.String(), aviso: Type.String() }, { examples: [{ id: "70ab9b94-8e0d-4d5c-b282-e45b1125b071", nome: "Parceiro Aurora", prefixo: "cv3.a1b2c3d4e5f6", permissoes: ["TRACE_READ", "ANALYTICS_READ"], organizacaoId: "70ab9b94-8e0d-4d5c-b282-e45b1125b071", ativa: true, criadoEm: "2026-11-16T12:00:00.000Z", apiKey: "cv3.a1b2c3d4e5f6.<segredo-exibido-uma-vez>", aviso: "Copie esta chave agora; ela nao sera exibida novamente." }] }) },
    },
  }, async (request, reply) => reply.code(201).send(await service.create(request.body)));
  app.patch<{ Params: Static<typeof KeyParams> }>("/internal/api-keys/:id/revoke", {
    preHandler: [admin],
    schema: { tags: ["Integrações internas"], summary: "Revogar uma chave de API", security: [{ bearerAuth: [] }], params: KeyParams },
  }, (request) => service.revoke(request.params.id));
}
