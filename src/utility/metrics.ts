import { db } from "../db";

type MetricName = "cooccurrence" | "cosine" | "confidence" | "lift";

export async function getActiveMetric(): Promise<MetricName> {
  const { rows } = await db.query(
    `SELECT "metric" FROM "RecommenderConfig" WHERE "id" = 1`
  );

  const metric = rows[0]?.metric as MetricName | undefined;
  return metric ?? "cooccurrence"; // fallback
}