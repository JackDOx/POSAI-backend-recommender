"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShopifyProducts = getShopifyProducts;
const db_1 = require("../db");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
async function getShopifyProducts(req, res) {
    try {
        // 1. Fetch products from Shopify
        const url = new URL(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/products.json`);
        url.searchParams.set('limit', '200'); // adjust later if you want pagination
        const response = await fetch(url.toString(), {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            const text = await response.text();
            console.error('Shopify error:', response.status, text);
            return res.status(500).json({ error: 'Failed to fetch products' });
        }
        const data = await response.json(); // { products: [...] }
        const products = data.products;
        // If no products, just clear table and return
        if (!products || products.length === 0) {
            await db_1.db.query('TRUNCATE "ProductVariant"');
            return res.json({ productsFetched: 0, variantsSaved: 0 });
        }
        const variants = [];
        for (const p of products) {
            const productId = String(p.id);
            const productTitle = p.title ?? '';
            for (const v of p.variants ?? []) {
                variants.push({
                    id: String(v.id),
                    productId,
                    productTitle,
                    variantTitle: v.title ?? '',
                    price: v.price ?? '0.00',
                    inventoryQuantity: v.inventory_quantity ?? 0,
                });
            }
        }
        // 3. Clear the table completely
        await db_1.db.query('TRUNCATE "ProductVariant"');
        if (variants.length === 0) {
            return res.json({
                productsFetched: products.length,
                variantsSaved: 0,
            });
        }
        // 4. Bulk insert all variants
        const values = [];
        const placeholders = [];
        let paramIndex = 1;
        for (const v of variants) {
            // ($1, $2, $3, $4, $5, $6), then ($7, $8, $9, $10, $11, $12), ...
            placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5})`);
            values.push(v.id, // "id" BIGINT
            v.productId, // "productId" BIGINT
            v.productTitle, // "productTitle" TEXT
            v.variantTitle, // "variantTitle" TEXT
            v.price, // "price" TEXT
            v.inventoryQuantity);
            paramIndex += 6;
        }
        const insertQuery = `
      INSERT INTO "ProductVariant" ("id", "productId", "productTitle", "variantTitle", "price", "inventoryQuantity")
      VALUES ${placeholders.join(', ')}
    `;
        await db_1.db.query(insertQuery, values);
        return res.json({
            productsFetched: products.length,
            variantsSaved: variants.length,
        });
    }
    catch (err) {
        console.error('Error fetching/saving Shopify products:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
