"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncShopifyOrders = syncShopifyOrders;
const db_1 = require("../db");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
// Pull orders from Shopify and store each line item in OrderLineItem
async function syncShopifyOrders(req, res) {
    try {
        const url = new URL(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/orders.json`);
        // tweak as you like
        url.searchParams.set('limit', '50');
        url.searchParams.set('status', 'any');
        const response = await fetch(url.toString(), {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            const text = await response.text();
            console.error('Shopify orders error:', response.status, text);
            return res.status(500).json({ error: 'Failed to fetch orders' });
        }
        const data = await response.json(); // { orders: [...] }
        const orders = data.orders || [];
        await db_1.db.query('BEGIN');
        // Clear old data first
        await db_1.db.query(`TRUNCATE "OrderLineItem"`);
        for (const order of orders) {
            const orderId = String(order.id);
            const orderNumber = order.order_number;
            const orderName = order.name;
            const createdAt = new Date(order.created_at);
            const currency = order.currency;
            const lineItems = order.line_items || [];
            for (const li of lineItems) {
                const isCustomSale = Array.isArray(li.properties) &&
                    li.properties.some((p) => p.name === '_shopify_item_type' && p.value === 'custom_sale');
                await db_1.db.query(`
          INSERT INTO "OrderLineItem" (
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
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
                    String(li.id),
                    orderId,
                    orderNumber,
                    orderName,
                    createdAt,
                    currency,
                    li.product_id ? String(li.product_id) : null,
                    li.variant_id ? String(li.variant_id) : null,
                    li.title,
                    li.quantity,
                    li.price,
                    li.sku || null,
                    isCustomSale,
                ]);
            }
        }
        await db_1.db.query('COMMIT');
        return res.json({
            message: 'Orders synced successfully',
            ordersCount: orders.length,
        });
    }
    catch (err) {
        // try rollback, ignore rollback errors
        try {
            await db_1.db.query('ROLLBACK');
        }
        catch { }
        console.error('Error syncing Shopify orders:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
