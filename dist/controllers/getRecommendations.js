"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecommendations = getRecommendations;
const db_1 = require("../db");
const metrics_1 = require("../utility/metrics");
/**
 * POST /recommendations
 * Body: { cartVariantIds: string[] }
 */
async function getRecommendations(req, res) {
    try {
        const cartVariantIds = req.body?.cartVariantIds || [];
        if (!Array.isArray(cartVariantIds) || cartVariantIds.length === 0) {
            return res.json({ metric: null, recommendations: [] });
        }
        // 🔎 Get current metric chosen by training
        const metric = await (0, metrics_1.getActiveMetric)(); // 'cooccurrence' | 'cosine' | 'confidence' | 'lift'
        console.log("Using recommender metric:", metric);
        const { rows } = await db_1.db.query(`
      WITH
      -- total number of distinct orders (N)
      global_stats AS (
        SELECT COUNT(DISTINCT "orderId")::float AS N
        FROM "OrderLineItem"
        WHERE "variantId" IS NOT NULL
      ),

      -- how many orders each variant appears in (countA, countB)
      variant_counts AS (
        SELECT
          "variantId",
          COUNT(DISTINCT "orderId")::float AS cnt
        FROM "OrderLineItem"
        WHERE "variantId" IS NOT NULL
        GROUP BY "variantId"
      ),

      -- all candidate pairs for the given cart, with co, countA, countB, N
      candidate_pairs AS (
        SELECT
          vs."sourceVariantId",
          vs."targetVariantId",
          vs."coCount"::float AS co,
          vca.cnt AS countA,
          vcb.cnt AS countB,
          gs.N
        FROM "VariantSimilarity" vs
        JOIN variant_counts vca
          ON vca."variantId" = vs."sourceVariantId"
        JOIN variant_counts vcb
          ON vcb."variantId" = vs."targetVariantId"
        CROSS JOIN global_stats gs
        WHERE vs."sourceVariantId" = ANY($1::text[])
          AND NOT (vs."targetVariantId" = ANY($1::text[]))
      ),

      -- compute metric-dependent score and sum over all cart items,
      -- while also tracking which cart variants contributed to each target
      candidate_scores AS (
        SELECT
          cp."targetVariantId" AS "variantId",
          ARRAY_AGG(DISTINCT cp."sourceVariantId") AS "sourceVariantIds",
          SUM(
            CASE
              WHEN $2 = 'cooccurrence' THEN
                cp.co

              WHEN $2 = 'cosine' THEN
                CASE
                  WHEN cp.countA <= 0 OR cp.countB <= 0 THEN 0
                  ELSE cp.co / sqrt(cp.countA * cp.countB)
                END

              WHEN $2 = 'confidence' THEN
                CASE
                  WHEN cp.countA <= 0 THEN 0
                  ELSE cp.co / cp.countA
                END

              WHEN $2 = 'lift' THEN
                CASE
                  WHEN cp.N <= 0 OR cp.countA <= 0 OR cp.countB <= 0 THEN 0
                  ELSE
                    (cp.co / cp.N)
                    / ((cp.countA / cp.N) * (cp.countB / cp.N))
                END

              ELSE
                cp.co  -- fallback: cooccurrence
            END
          ) AS score
        FROM candidate_pairs cp
        GROUP BY cp."targetVariantId"
      )

      SELECT
        cs."variantId",
        cs.score,
        cs."sourceVariantIds",
        pv."productId",
        pv."productTitle",
        pv."variantTitle",
        pv.price,
        pv."inventoryQuantity"
      FROM candidate_scores cs
      JOIN "ProductVariant" pv
        ON pv."id"::text = cs."variantId"
      WHERE pv."inventoryQuantity" > 0
      ORDER BY cs.score DESC, pv."productTitle" ASC
      LIMIT 2;
      `, [cartVariantIds, metric]);
        // rows[i].sourceVariantIds will be a string[] of cart variant IDs
        // that contributed to this recommendation
        res.json({ metric, recommendations: rows });
    }
    catch (err) {
        console.error("Error getting recommendations:", err);
        res.status(500).json({ error: "Failed to get recommendations" });
    }
}
