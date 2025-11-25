"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testEndpoint = testEndpoint;
const db_1 = require("../db");
async function testEndpoint(req, res) {
    const result = await db_1.db.query('SELECT NOW()');
    res.json({ time: result.rows[0] });
}
