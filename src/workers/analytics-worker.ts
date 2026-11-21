import "dotenv/config";
import { StatusRelatorioAnalitico } from "@prisma/client";
import { Worker } from "bullmq";
import { AnalyticsService } from "../analytics/analytics-service";
import { createRedisConnection } from "../queues/redis-connection";
import { prisma } from "../shared/prisma";

const analytics = new AnalyticsService();
const connection = createRedisConnection();
const worker = new Worker("greencode-analytics", async (job) => {
  const { reportId, organizacaoId } = job.data as { reportId: string; organizacaoId: string };
  const tentativa = job.attemptsMade + 1;
  await prisma.relatorioAnalitico.update({
    where: { id: reportId },
    data: { status: StatusRelatorioAnalitico.PROCESSANDO, iniciadoEm: new Date(), tentativas: tentativa, erro: null, versao: { increment: 1 } },
  });
  try {
    const resultado = await analytics.pacoteCompleto(organizacaoId);
    await prisma.relatorioAnalitico.update({
      where: { id: reportId },
      data: { status: StatusRelatorioAnalitico.CONCLUIDO, resultado, concluidoEm: new Date(), versao: { increment: 1 } },
    });
    return { reportId, status: "CONCLUIDO" };
  } catch (error) {
    const finalAttempt = tentativa >= (job.opts.attempts ?? 3);
    await prisma.relatorioAnalitico.update({
      where: { id: reportId },
      data: {
        status: finalAttempt ? StatusRelatorioAnalitico.FALHOU : StatusRelatorioAnalitico.PENDENTE,
        erro: finalAttempt ? "Falha ao calcular relatorio apos novas tentativas." : null,
        ...(finalAttempt ? { concluidoEm: new Date() } : {}),
        versao: { increment: 1 },
      },
    });
    throw error;
  }
}, { connection, concurrency: 2 });

worker.on("ready", () => console.log("Worker de analytics pronto."));
worker.on("completed", (job) => console.log(`Relatorio ${job.id} concluido.`));
worker.on("failed", (job, error) => console.error(`Falha no relatorio ${job?.id}:`, error.message));
worker.on("error", (error) => console.error("Erro no worker de analytics:", error));

async function shutdown(signal: string) {
  console.log(`Encerrando worker (${signal}).`);
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
