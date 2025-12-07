"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecommendations = getRecommendations;
const db_1 = require("../db");
/**
 * POST /recommendations
 * Body: { cartVariantIds: string[] }
 */
async function getRecommendations(req, res) {
    try {
        const cartVariantIds = req.body?.cartVariantIds || [];
        if (!Array.isArray(cartVariantIds) || cartVariantIds.length === 0) {
            return res.json({ recommendations: [] });
        }
        // 1) Aggregate co-occurrence scores for all candidate variants
        // 2) Join to ProductVariant for product details + inventory
        // 3) Filter out items already in cart
        // 4) Return top 2
        const { rows } = await db_1.db.query(`
      WITH candidate_scores AS (
        SELECT
          vs."targetVariantId" AS "variantId",
          SUM(vs."coCount") AS score
        FROM "VariantSimilarity" vs
        WHERE vs."sourceVariantId" = ANY($1::text[])
          AND NOT (vs."targetVariantId" = ANY($1::text[]))
        GROUP BY vs."targetVariantId"
      )
      SELECT
        cs."variantId",
        cs.score,
        pv."productId",
        pv."productTitle",
        pv."variantTitle",
        pv.price,
        pv."inventoryQuantity"
      FROM candidate_scores cs
      JOIN "ProductVariant" pv
        ON pv.id = cs."variantId"
      WHERE pv."inventoryQuantity" > 0
      ORDER BY cs.score DESC, pv."productTitle" ASC
      LIMIT 2;
      `, [cartVariantIds]);
        res.json({ recommendations: rows });
    }
    catch (err) {
        console.error("Error getting recommendations:", err);
        res.status(500).json({ error: "Failed to get recommendations" });
    }
}
