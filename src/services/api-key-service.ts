import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../shared/prisma";
import { badRequest, notFound } from "../shared/errors";
import { API_PERMISSIONS, type ApiPermission } from "../shared/api-permissions";

export class ApiKeyService {
  async create(input: { nome: string; organizacaoId: string; permissoes: ApiPermission[] }) {
    const nome = input.nome.trim();
    if (!nome) throw badRequest("Informe um nome para a integração.");
    if (!input.permissoes.length || input.permissoes.some((item) => !API_PERMISSIONS.includes(item))) {
      throw badRequest("Selecione ao menos uma permissão válida.");
    }
    const organization = await prisma.organizacao.findUnique({ where: { id: input.organizacaoId }, select: { id: true } });
    if (!organization) throw notFound("Organização");

    const randomPrefix = randomBytes(6).toString("hex");
    const secret = randomBytes(32).toString("base64url");
    const apiKey = `cv3.${randomPrefix}.${secret}`;
    const prefixo = `cv3.${randomPrefix}`;
    const segredoHash = createHash("sha256").update(apiKey).digest("hex");
    const record = await prisma.chaveApi.create({
      data: { nome, organizacaoId: input.organizacaoId, prefixo, segredoHash, permissoes: [...new Set(input.permissoes)] },
      select: { id: true, nome: true, prefixo: true, permissoes: true, organizacaoId: true, ativa: true, criadoEm: true },
    });
    return { ...record, apiKey, aviso: "Copie esta chave agora; ela nao sera exibida novamente." };
  }

  list() {
    return prisma.chaveApi.findMany({
      select: { id: true, nome: true, prefixo: true, permissoes: true, organizacaoId: true, ativa: true, criadoEm: true, revogadaEm: true, versao: true },
      orderBy: { criadoEm: "desc" },
    });
  }

  async revoke(id: string) {
    const result = await prisma.chaveApi.updateMany({ where: { id, ativa: true }, data: { ativa: false, revogadaEm: new Date(), versao: { increment: 1 } } });
    if (result.count !== 1) throw notFound("Chave de API ativa");
    return { id, ativa: false, revogadaEm: new Date().toISOString() };
  }
}
