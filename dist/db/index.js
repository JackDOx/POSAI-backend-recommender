"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Replace both the username and password in the DATABASE_URL with DB_USER and DB_PASSWORD from .env
let connectionString = process.env.DATABASE_URL;
if (connectionString && process.env.DB_USER && process.env.DB_PASSWORD) {
    connectionString = connectionString.replace(/(postgres(?:ql)?:\/\/)[^:]+:[^@]+(@.*)/, (_match, p1, p2) => `${p1}${process.env.DB_USER}:${process.env.DB_PASSWORD}${p2}`);
}
console.log("MY CONNECTION STRING:", connectionString);
exports.db = new pg_1.Pool({
    connectionString,
});
exports.db.connect()
    .then(() => console.log("Connected to PostgreSQL"))
    .catch(err => console.error("DB connection error:", err));
