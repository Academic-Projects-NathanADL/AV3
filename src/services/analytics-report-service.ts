import { StatusRelatorioAnalitico, TipoRelatorioAnalitico } from "@prisma/client";
import { analyticsQueue } from "../queues/analytics-queue";
import { conflict, notFound } from "../shared/errors";
import { prisma } from "../shared/prisma";

export class AnalyticsReportService {
  async request(organizacaoId: string, chaveApiId: string) {
    const report = await prisma.relatorioAnalitico.create({
      data: { tipo: TipoRelatorioAnalitico.PACOTE_ANALITICO, organizacaoId, chaveApiId },
      select: { id: true, status: true, solicitadoEm: true },
    });
    try {
      await analyticsQueue.add("generate-analytics", { reportId: report.id, organizacaoId }, { jobId: report.id });
    } catch (error) {
      await prisma.relatorioAnalitico.update({ where: { id: report.id }, data: { status: StatusRelatorioAnalitico.FALHOU, erro: "Fila analitica indisponivel.", concluidoEm: new Date(), versao: { increment: 1 } } });
      throw error;
    }
    return { ...report, links: { status: `/api/v1/public/v1/analytics/reports/${report.id}`, download: `/api/v1/public/v1/analytics/reports/${report.id}/download` } };
  }

  async status(id: string, chaveApiId: string, organizacaoId: string) {
    const report = await prisma.relatorioAnalitico.findFirst({
      where: { id, chaveApiId, organizacaoId },
      select: { id: true, tipo: true, status: true, solicitadoEm: true, iniciadoEm: true, concluidoEm: true, tentativas: true, erro: true, versao: true },
    });
    if (!report) throw notFound("Relatorio analitico");
    return report;
  }

  async result(id: string, chaveApiId: string, organizacaoId: string) {
    const report = await prisma.relatorioAnalitico.findFirst({
      where: { id, chaveApiId, organizacaoId },
      select: { id: true, status: true, concluidoEm: true, resultado: true, erro: true },
    });
    if (!report) throw notFound("Relatorio analitico");
    if (report.status === StatusRelatorioAnalitico.FALHOU) throw conflict(report.erro ?? "O relatorio falhou.");
    if (report.status !== StatusRelatorioAnalitico.CONCLUIDO || !report.resultado) throw conflict("O relatorio ainda esta sendo processado.");
    return report;
  }
}
