import { Queue } from "bullmq";
import { createRedisConnection } from "./redis-connection";

export type AnalyticsJobData = { reportId: string; organizacaoId: string };

export const queueRedisConnection = createRedisConnection();
export const analyticsQueue = new Queue<AnalyticsJobData>("greencode-analytics", {
  connection: queueRedisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
    removeOnFail: { age: 60 * 60 * 24 * 30, count: 5000 },
  },
});

export async function closeAnalyticsQueue() {
  await analyticsQueue.close();
  await queueRedisConnection.quit();
}
