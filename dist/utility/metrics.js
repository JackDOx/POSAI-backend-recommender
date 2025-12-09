"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveMetric = getActiveMetric;
const db_1 = require("../db");
async function getActiveMetric() {
    const { rows } = await db_1.db.query(`SELECT "metric" FROM "RecommenderConfig" WHERE "id" = 1`);
    const metric = rows[0]?.metric;
    return metric ?? "cooccurrence"; // fallback
}
