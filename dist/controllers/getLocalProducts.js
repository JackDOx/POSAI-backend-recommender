"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocalProducts = getLocalProducts;
const db_1 = require("../db");
async function getLocalProducts(req, res) {
    try {
        const result = await db_1.db.query(`SELECT "id",
              "productId",
              "productTitle",
              "variantTitle",
              "price",
              "inventoryQuantity"
       FROM "ProductVariant"
       ORDER BY "productId", "id"`);
        return res.json({
            count: result.rowCount,
            products: result.rows,
        });
    }
    catch (err) {
        console.error('Error fetching local products from DB:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
