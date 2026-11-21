import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { forbidden, unauthorized } from "../shared/errors";
import type { ApiPermission } from "../shared/api-permissions";
import { prisma } from "../shared/prisma";

export type ApiClient = { id: string; nome: string; organizacaoId: string; permissoes: string[] };

declare module "fastify" {
  interface FastifyRequest { apiClient?: ApiClient }
  interface FastifyInstance {
    authenticateApiKey: preHandlerHookHandler;
    requireApiPermission: (permission: ApiPermission) => preHandlerHookHandler;
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export async function registerApiKeyAuth(app: FastifyInstance): Promise<void> {
  app.decorate("authenticateApiKey", async function (request: FastifyRequest) {
    const rawKey = request.headers["x-api-key"];
    if (typeof rawKey !== "string") throw unauthorized();
    const match = /^cv3\.([a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/.exec(rawKey);
    if (!match) throw unauthorized();
    const prefix = `cv3.${match[1]}`;
    const key = await prisma.chaveApi.findUnique({ where: { prefixo: prefix } });
    if (!key || !key.ativa) throw unauthorized();
    const provided = sha256(rawKey);
    const expected = Buffer.from(key.segredoHash, "hex");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw unauthorized();
    request.apiClient = { id: key.id, nome: key.nome, organizacaoId: key.organizacaoId, permissoes: key.permissoes };
  });

  app.decorate("requireApiPermission", (permission: ApiPermission) => async function (request: FastifyRequest) {
    if (!request.apiClient) throw unauthorized();
    if (!request.apiClient.permissoes.includes(permission)) throw forbidden();
  });
}
