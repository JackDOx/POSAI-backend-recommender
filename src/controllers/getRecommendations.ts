import { Request, Response } from "express";
import { db } from "../db";

/**
 * POST /recommendations
 * Body options:
 *  - { cartVariantIds: string[] }
 *  - or { variants: [{ id: string }] }  // for your extension payload
 */
export async function getRecommendations(req: Request, res: Response) {
  try {
    let cartVariantIds: string[] = req.body?.cartVariantIds || [];

    // Also support { variants: [{ id }] } because of your extension format
    if (
      (!cartVariantIds || cartVariantIds.length === 0) &&
      Array.isArray(req.body?.variants)
    ) {
      cartVariantIds = req.body.variants
        .map((v: any) => (v && v.id ? String(v.id) : null))
        .filter((id: string | null): id is string => id !== null);
    }

    if (!Array.isArray(cartVariantIds) || cartVariantIds.length === 0) {
      return res.json({ recommendations: [] });
    }

    const { rows } = await db.query(
      `
      WITH candidate_scores AS (
        SELECT
          -- force targetVariantId to text so we can join on text later
          vs."targetVariantId"::text AS "variantId",
          SUM(vs."coCount") AS score
        FROM "VariantSimilarity" vs
        WHERE vs."sourceVariantId"::text = ANY($1::text[])
          AND NOT (vs."targetVariantId"::text = ANY($1::text[]))
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
        -- 👇 cast pv.id to text as well; now it's text = text, no more bigint=text error
        ON pv."id"::text = cs."variantId"
      WHERE pv."inventoryQuantity" > 0
      ORDER BY cs.score DESC, pv."productTitle" ASC
      LIMIT 2;
      `,
      [cartVariantIds]
    );

    res.json({ recommendations: rows });
  } catch (err) {
    console.error("Error getting recommendations:", err);
    res.status(500).json({ error: "Failed to get recommendations" });
  }
}
