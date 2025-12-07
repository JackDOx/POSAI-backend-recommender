"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocalOrders = getLocalOrders;
const db_1 = require("../db");
async function getLocalOrders(req, res) {
    try {
        const result = await db_1.db.query(`
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
    `);
        return res.json({
            count: result.rowCount,
            orderLineItems: result.rows,
        });
    }
    catch (err) {
        console.error('Error fetching local orders from DB:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
