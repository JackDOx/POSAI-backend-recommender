"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/ai/trainRecommender.ts
const db_1 = require("../db");
// 🔹 Use OrderLineItem instead of the non-existent Order / OrderItem
async function fetchOrders() {
    const { rows } = await db_1.db.query(`
    SELECT
      "orderId"   AS order_id,
      "createdAt" AS created_at,
      "variantId" AS variant_id
    FROM "OrderLineItem"
    WHERE "variantId" IS NOT NULL
    ORDER BY "createdAt" ASC
    `);
    const map = new Map();
    for (const row of rows) {
        if (!map.has(row.order_id)) {
            map.set(row.order_id, {
                createdAt: row.created_at,
                variants: new Set(),
            });
        }
        // variantId is already text in DB, we keep it as string
        map.get(row.order_id).variants.add(row.variant_id);
    }
    const baskets = [];
    for (const [orderId, { createdAt, variants }] of map.entries()) {
        // ✅ Keep ALL orders with at least 1 variant
        baskets.push({
            orderId,
            createdAt,
            variants: Array.from(variants),
        });
    }
    return baskets;
}
function trainTestSplitByTime(orders, trainRatio = 0.8) {
    // orders already sorted by createdAt ASC from SQL
    const n = orders.length;
    const splitIndex = Math.floor(n * trainRatio);
    const train = orders.slice(0, splitIndex);
    const val = orders.slice(splitIndex);
    return { train, val };
}
function buildStats(trainOrders) {
    const variantCounts = new Map();
    const pairCounts = new Map();
    const adjacency = new Map();
    const mkKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    for (const order of trainOrders) {
        const variants = order.variants;
        const unique = Array.from(new Set(variants));
        // 🔹 Count single appearances (includes single-item orders)
        for (const v of unique) {
            variantCounts.set(v, (variantCounts.get(v) || 0) + 1);
            if (!adjacency.has(v))
                adjacency.set(v, new Set());
        }
        // 🔹 Count pairs only if there are at least 2 items
        if (unique.length >= 2) {
            for (let i = 0; i < unique.length; i++) {
                for (let j = i + 1; j < unique.length; j++) {
                    const a = unique[i];
                    const b = unique[j];
                    const key = mkKey(a, b);
                    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
                    adjacency.get(a).add(b);
                    adjacency.get(b).add(a);
                }
            }
        }
    }
    return {
        numTrainOrders: trainOrders.length,
        variantCounts,
        pairCounts,
        adjacency,
    };
}
function makeScoreFn(metric, stats) {
    const { variantCounts, pairCounts, numTrainOrders } = stats;
    const mkKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    return (a, b) => {
        const key = mkKey(a, b);
        const co = pairCounts.get(key) || 0;
        if (co === 0)
            return 0;
        const countA = variantCounts.get(a) || 0;
        const countB = variantCounts.get(b) || 0;
        if (countA === 0 || countB === 0)
            return 0;
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
                const N = numTrainOrders;
                if (N === 0)
                    return 0;
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
function recommendForCart(cart, stats, scoreFn, k) {
    const { adjacency } = stats;
    if (cart.length === 0)
        return [];
    const cartSet = new Set(cart);
    const candidateScores = new Map();
    for (const a of cart) {
        const neighbors = adjacency.get(a);
        if (!neighbors)
            continue;
        for (const b of neighbors) {
            if (cartSet.has(b))
                continue; // don't recommend what's already in cart
            const scoreAB = scoreFn(a, b);
            if (scoreAB <= 0)
                continue;
            candidateScores.set(b, (candidateScores.get(b) || 0) + scoreAB);
        }
    }
    const sorted = Array.from(candidateScores.entries())
        .sort(([, s1], [, s2]) => s2 - s1)
        .map(([variantId]) => variantId);
    return sorted.slice(0, k);
}
function evaluateMetric(metric, stats, valOrders, k = 2) {
    const scoreFn = makeScoreFn(metric, stats);
    let nUsed = 0;
    let sumHit = 0;
    let sumPrecision = 0;
    let sumRecall = 0;
    for (const order of valOrders) {
        const variants = order.variants;
        if (variants.length < 2)
            continue;
        // Leave-one-out: cart = all but last, heldOut = last
        const cart = variants.slice(0, variants.length - 1);
        const heldOut = [variants[variants.length - 1]];
        const recs = recommendForCart(cart, stats, scoreFn, k);
        if (recs.length === 0)
            continue;
        const heldOutSet = new Set(heldOut);
        const recSet = new Set(recs);
        let hits = 0;
        for (const v of recSet) {
            if (heldOutSet.has(v))
                hits++;
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
        recallAtK: sumRecall / nUsed,
    };
}
async function main() {
    console.log("Fetching orders...");
    const baskets = await fetchOrders();
    console.log(`Total orders (>=1 item): ${baskets.length}`);
    if (baskets.length < 5) {
        console.log("Not enough data to evaluate. Need more orders.");
        process.exit(0);
    }
    const { train, val } = trainTestSplitByTime(baskets, 0.8);
    console.log(`Train orders: ${train.length}, Val orders: ${val.length}`);
    console.log("Building train stats...");
    const stats = buildStats(train);
    const metrics = [
        "cooccurrence",
        "cosine",
        "confidence",
        "lift",
    ];
    const results = [];
    for (const metric of metrics) {
        const r = evaluateMetric(metric, stats, val, 2);
        results.push(r);
    }
    console.log("\n=== Evaluation Results (K=2) ===");
    for (const r of results) {
        console.log(`${r.metric.padEnd(12)} -> HitRate@2=${r.hitRateAtK.toFixed(3)}, Precision@2=${r.precisionAtK.toFixed(3)}, Recall@2=${r.recallAtK.toFixed(3)}`);
    }
    // pick metric with best HitRate@2 (change to precision/recall if you prefer)
    let best = results[0];
    for (const r of results.slice(1)) {
        if (r.hitRateAtK > best.hitRateAtK)
            best = r;
    }
    console.log("\nBest metric by HitRate@2:", best.metric);
    console.log(`HitRate@2=${best.hitRateAtK.toFixed(3)}, Precision@2=${best.precisionAtK.toFixed(3)}, Recall@2=${best.recallAtK.toFixed(3)}`);
    // 🔥 Persist the chosen metric into RecommenderConfig
    await db_1.db.query(`
    INSERT INTO "RecommenderConfig" ("id", "metric", "updatedAt")
    VALUES (1, $1, NOW())
    ON CONFLICT ("id")
    DO UPDATE
      SET "metric" = EXCLUDED."metric",
          "updatedAt" = NOW();
    `, [best.metric]);
    console.log(`\nSaved best metric "${best.metric}" to RecommenderConfig (id=1).`);
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
