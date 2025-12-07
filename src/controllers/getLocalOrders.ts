import { Request, Response } from 'express';
import { db } from '../db';

export async function getLocalOrders(req: Request, res: Response) {
  try {
    const result = await db.query(
      `
      SELECT
        "id",
        "orderId",
        "orderNumber",
        "orderName",
        "createdAt",
        "currency",
        "productId",
        "variantId",
        "lineItemTitle",
        "quantity",
        "price",
        "sku",
        "isCustomSale"
      FROM "OrderLineItem"
      ORDER BY "orderNumber" DESC, "id"
    `
    );

    return res.json({
      count: result.rowCount,
      orderLineItems: result.rows,
    });
  } catch (err) {
    console.error('Error fetching local orders from DB:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
