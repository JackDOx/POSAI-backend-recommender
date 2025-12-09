"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuildVariantSimilarity = rebuildVariantSimilarity;
const db_1 = require("../db");
/**
 * DEV-ONLY endpoint: recompute item–item similarities from all orders.
 * Assumes:
 *  - "OrderLineItem" table exists
 *  - columns: "orderId", "variantId"
 *  - variantId is NOT NULL for “real” products
 */
async function rebuildVariantSimilarity(req, res) {
    try {
        // 1. Clear existing similarity rows
        await db_1.db.query(`TRUNCATE TABLE "VariantSimilarity"`);
        // 2. Compute co-occurrence counts
        await db_1.db.query(`
      INSERT INTO "VariantSimilarity" ("sourceVariantId", "targetVariantId", "coCount")
      SELECT
        li1."variantId" AS "sourceVariantId",
        li2."variantId" AS "targetVariantId",
        COUNT(DISTINCT li1."orderId") AS "coCount"
      FROM "OrderLineItem" li1
      JOIN "OrderLineItem" li2
        ON li1."orderId" = li2."orderId"
       AND li1."variantId" <> li2."variantId"
      WHERE li1."variantId" IS NOT NULL
        AND li2."variantId" IS NOT NULL
      GROUP BY li1."variantId", li2."variantId";
    `);
        res.json({ ok: true });
    }
    catch (err) {
        console.error("Error rebuilding VariantSimilarity:", err);
        res.status(500).json({ error: "Failed to rebuild similarity" });
    }
}
