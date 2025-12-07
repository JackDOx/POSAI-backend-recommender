import { Request, Response } from 'express';
import { db } from '../db';

export async function getLocalProducts(req: Request, res: Response) {
  try {
    const result = await db.query(
      `SELECT "id",
              "productId",
              "productTitle",
              "variantTitle",
              "price",
              "inventoryQuantity"
       FROM "ProductVariant"
       ORDER BY "productId", "id"`
    );

    return res.json({
      count: result.rowCount,
      products: result.rows,
    });
  } catch (err) {
    console.error('Error fetching local products from DB:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
