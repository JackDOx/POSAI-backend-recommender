// src/training/trainRecommender.ts
import { db } from "../db";

// Treat variant IDs as strings in JS, even if they are BIGINT in Postgres.
type VariantId = string;

interface OrderRow {
  order_id: string;
  created_at: Date;
  variant_id: VariantId;
}

interface OrderBasket {
  orderId: string;
  createdAt: Date;
  variants: VariantId[]; // unique variants in that order
}

type MetricName = "cooccurrence" | "cosine" | "confidence" | "lift";

interface EvalResult {
  metric: MetricName;
  hitRateAtK: number;
  precisionAtK: number;
  recallAtK: number;
}

async function fetchOrders(): Promise<OrderBasket[]> {
  // Adjust table/column names if needed
  const { rows } = await db.query<OrderRow>(
    `
    SELECT
      o.id AS order_id,
      o."createdAt" AS created_at,
      oi."variantId"::text AS variant_id
    FROM "Order" o
    JOIN "OrderItem" oi
      ON oi."orderId" = o.id
    ORDER BY o."createdAt" ASC
    `
  );

  // Group rows by order_id
  const map = new Map<string, { createdAt: Date; variants: Set<VariantId> }>();

  for (const row of rows) {
    if (!map.has(row.order_id)) {
      map.set(row.order_id, {
        createdAt: row.created_at,
        variants: new Set<VariantId>()
      });
    }
    map.get(row.order_id)!.variants.add(row.variant_id);
  }

  const baskets: OrderBasket[] = [];
  for (const [orderId, { createdAt, variants }] of map.entries()) {
    // Only keep orders with at least 2 distinct variants,
    // otherwise they don't help with co-occurrence.
    if (variants.size >= 2) {
      baskets.push({
        orderId,
        createdAt,
        variants: Array.from(variants)
      });
    }
  }

  return baskets;
}

function trainTestSplitByTime(
  orders: OrderBasket[],
  trainRatio = 0.8
): { train: OrderBasket[]; val: OrderBasket[] } {
  // orders are already sorted by createdAt ASC from SQL
  const n = orders.length;
  const splitIndex = Math.floor(n * trainRatio);
  const train = orders.slice(0, splitIndex);
  const val = orders.slice(splitIndex);
  return { train, val };
}

interface Stats {
  numTrainOrders: number;
  variantCounts: Map<VariantId, number>;
  pairCounts: Map<string, number>; // key = "a|b" with a < b
  adjacency: Map<VariantId, Set<VariantId>>;
}

function buildStats(trainOrders: OrderBasket[]): Stats {
  const variantCounts = new Map<VariantId, number>();
  const pairCounts = new Map<string, number>();
  const adjacency = new Map<VariantId, Set<VariantId>>();

  const mkKey = (a: VariantId, b: VariantId) => {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };

  for (const order of trainOrders) {
    const variants = order.variants;
    const unique = Array.from(new Set(variants));

    // count single appearances
    for (const v of unique) {
      variantCounts.set(v, (variantCounts.get(v) || 0) + 1);
      if (!adjacency.has(v)) adjacency.set(v, new Set());
    }

    // count pairs
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i];
        const b = unique[j];
        const key = mkKey(a, b);
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);

        adjacency.get(a)!.add(b);
        adjacency.get(b)!.add(a);
      }
    }
  }

  return {
    numTrainOrders: trainOrders.length,
    variantCounts,
    pairCounts,
    adjacency
  };
}

function makeScoreFn(
  metric: MetricName,
  stats: Stats
): (a: VariantId, b: VariantId) => number {
  const { variantCounts, pairCounts, numTrainOrders } = stats;

  const mkKey = (a: VariantId, b: VariantId) =>
    a < b ? `${a}|${b}` : `${b}|${a}`;

  return (a: VariantId, b: VariantId) => {
    const key = mkKey(a, b);
    const co = pairCounts.get(key) || 0;
    if (co === 0) return 0;

    const countA = variantCounts.get(a) || 0;
    const countB = variantCounts.get(b) || 0;
    if (countA === 0 || countB === 0) return 0;

    switch (metric) {
      case "cooccurrence":
        // Just raw coCount
        return co;

      case "cosine":
        // co / sqrt(countA * countB)
        return co / Math.sqrt(countA * countB);

      case "confidence":
        // P(B|A) = co / countA
        return co / countA;

      case "lift": {
        // lift(A,B) = P(A,B) / (P(A) * P(B))
        // where P(A) = countA / N, P(B) = countB / N, P(A,B) = co / N
        const N = numTrainOrders;
        if (N === 0) return 0;
        const pAB = co / N;
        const pA = countA / N;
        const pB = countB / N;
        return pAB / (pA * pB);
      }

      default:
        return 0;
    }
  };
}

function recommendForCart(
  cart: VariantId[],
  stats: Stats,
  scoreFn: (a: VariantId, b: VariantId) => number,
  k: number
): VariantId[] {
  const { adjacency } = stats;
  if (cart.length === 0) return [];

  const cartSet = new Set(cart);
  const candidateScores = new Map<VariantId, number>();

  // Gather all neighbors of anything in the cart
  for (const a of cart) {
    const neighbors = adjacency.get(a);
    if (!neighbors) continue;

    for (const b of neighbors) {
      if (cartSet.has(b)) continue; // don't recommend what's already in cart
      const scoreAB = scoreFn(a, b);
      if (scoreAB <= 0) continue;
      candidateScores.set(b, (candidateScores.get(b) || 0) + scoreAB);
    }
  }

  // Sort by score desc, then by id as tiebreaker
  const sorted = Array.from(candidateScores.entries())
    .sort(([, s1], [, s2]) => s2 - s1)
    .map(([variantId]) => variantId);

  return sorted.slice(0, k);
}

function evaluateMetric(
  metric: MetricName,
  stats: Stats,
  valOrders: OrderBasket[],
  k = 2
): EvalResult {
  const scoreFn = makeScoreFn(metric, stats);

  let nUsed = 0;
  let sumHit = 0;
  let sumPrecision = 0;
  let sumRecall = 0;

  for (const order of valOrders) {
    const variants = order.variants;
    if (variants.length < 2) continue;

    // simple "leave-one-out" split:
    // cart = all but last, heldOut = last
    const cart = variants.slice(0, variants.length - 1);
    const heldOut = [variants[variants.length - 1]];

    const recs = recommendForCart(cart, stats, scoreFn, k);
    if (recs.length === 0) continue;

    const heldOutSet = new Set(heldOut);
    const recSet = new Set(recs);

    let hits = 0;
    for (const v of recSet) {
      if (heldOutSet.has(v)) hits++;
    }

    const hit = hits > 0 ? 1 : 0;
    const precision = hits / recs.length;
    const recall = hits / heldOut.length;

    nUsed++;
    sumHit += hit;
    sumPrecision += precision;
    sumRecall += recall;
  }

  if (nUsed === 0) {
    return { metric, hitRateAtK: 0, precisionAtK: 0, recallAtK: 0 };
  }

  return {
    metric,
    hitRateAtK: sumHit / nUsed,
    precisionAtK: sumPrecision / nUsed,
    recallAtK: sumRecall / nUsed
  };
}

async function main() {
  console.log("Fetching orders...");
  const baskets = await fetchOrders();
  console.log(`Total orders with >=2 items: ${baskets.length}`);

  if (baskets.length < 5) {
    console.log("Not enough data to evaluate. Need more orders.");
    process.exit(0);
  }

  const { train, val } = trainTestSplitByTime(baskets, 0.8);
  console.log(`Train orders: ${train.length}, Val orders: ${val.length}`);

  console.log("Building train stats...");
  const stats = buildStats(train);

  const metrics: MetricName[] = [
    "cooccurrence",
    "cosine",
    "confidence",
    "lift"
  ];

  const results: EvalResult[] = [];

  for (const metric of metrics) {
    const r = evaluateMetric(metric, stats, val, 2);
    results.push(r);
  }

  console.log("\n=== Evaluation Results (K=2) ===");
  for (const r of results) {
    console.log(
      `${r.metric.padEnd(12)} -> HitRate@2=${r.hitRateAtK.toFixed(
        3
      )}, Precision@2=${r.precisionAtK.toFixed(
        3
      )}, Recall@2=${r.recallAtK.toFixed(3)}`
    );
  }

  // pick metric with best HitRate@2 (you can change to precision/recall)
  let best = results[0];
  for (const r of results.slice(1)) {
    if (r.hitRateAtK > best.hitRateAtK) best = r;
  }

  console.log("\nBest metric by HitRate@2:", best.metric);
  console.log(
    `HitRate@2=${best.hitRateAtK.toFixed(
      3
    )}, Precision@2=${best.precisionAtK.toFixed(
      3
    )}, Recall@2=${best.recallAtK.toFixed(3)}`
  );

  // TODO (optional): write best.metric into a config table or file.
  // For now we just print it.
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error in training script:", err);
    process.exit(1);
  });