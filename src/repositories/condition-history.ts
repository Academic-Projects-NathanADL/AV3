import { EstadoFisico, OrigemObservacaoCondicao, type Prisma } from "@prisma/client";
import { calcularEstimativaFinanceira } from "../domain/financial";

const stateLevel: Record<EstadoFisico, number> = { EXCELENTE: 0, BOM: 1, REGULAR: 2, RUIM: 3, INSERVIVEL: 4 };
const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;

export async function registrarObservacaoCondicao(
  tx: Prisma.TransactionClient,
  item: { id: string; criadoEm: Date; idadeMeses: number | null; valorAquisicaoCentavos: number | null },
  estadoFisico: EstadoFisico,
  ocorridoEm: Date,
  origem: OrigemObservacaoCondicao,
  estadoAnterior?: EstadoFisico,
) {
  if (item.idadeMeses === null) return;
  const idadeMeses = Number(Math.max(0, item.idadeMeses + (ocorridoEm.getTime() - item.criadoEm.getTime()) / MONTH_MS).toFixed(2));
  const parameters = await tx.parametroFinanceiro.findUnique({ where: { id: 1 }, select: { coeficienteDepreciacaoAnualBps: true } });
  const valorContabilCentavos = item.valorAquisicaoCentavos === null ? null : calcularEstimativaFinanceira({
    valorAquisicaoCentavos: item.valorAquisicaoCentavos,
    idadeMeses,
    coeficienteDepreciacaoAnualBps: parameters?.coeficienteDepreciacaoAnualBps ?? 2000,
    aliquotaImpostoBps: 0,
  }).valorContabilCentavos;
  const depreciacaoAcumuladaCentavos = item.valorAquisicaoCentavos === null || valorContabilCentavos === null
    ? null
    : Math.max(0, item.valorAquisicaoCentavos - valorContabilCentavos);
  const falha = estadoAnterior !== undefined && stateLevel[estadoFisico] > stateLevel[estadoAnterior];
  await tx.observacaoCondicao.create({
    data: { equipamentoId: item.id, idadeMeses, estadoFisico, valorContabilCentavos, depreciacaoAcumuladaCentavos, origem, falha, ocorridoEm },
  });
}
