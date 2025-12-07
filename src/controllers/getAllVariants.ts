// src/controllers/getVariantSimilarities.ts
import { Request, Response } from 'express';
import { db } from '../db';

export async function getVariantSimilarities(req: Request, res: Response) {
  try {
    // Optional filters: ?minCo=2&source=46812313026714
    const minCo = Number(req.query.minCo ?? 1);
    const source = req.query.source as string | undefined;

    const params: any[] = [];
    const whereClauses: string[] = [];

    // Filter by minimum co-occurrence count
    params.push(minCo);
    whereClauses.push(`vs."coCount" >= $${params.length}`);

    // Optional: filter by a specific source variant
    if (source) {
      // keep as string; column is text, so compare text = text
      params.push(source);
      whereClauses.push(`vs."sourceVariantId" = $${params.length}`);
    }

    const { rows } = await db.query(
      `
      SELECT
        vs."sourceVariantId",
        src."productTitle"  AS "sourceProductTitle",
        src."variantTitle"  AS "sourceVariantTitle",
        vs."targetVariantId",
        tgt."productTitle"  AS "targetProductTitle",
        tgt."variantTitle"  AS "targetVariantTitle",
        vs."coCount"
      FROM "VariantSimilarity" vs
      LEFT JOIN "ProductVariant" src
        ON src."id" = vs."sourceVariantId"::bigint
      LEFT JOIN "ProductVariant" tgt
        ON tgt."id" = vs."targetVariantId"::bigint
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY
        vs."coCount" DESC,
        vs."sourceVariantId",
        vs."targetVariantId"
      LIMIT 500
      `,
      params
    );

    res.json({ count: rows.length, similarities: rows });
  } catch (err) {
    console.error('Error fetching variant similarities:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
