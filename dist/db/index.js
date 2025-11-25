"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const connectionString = process.env.DATABASE_URL?.replace(/(postgres:\/\/[^:]+:)[^@]+(@)/, (_match, p1, p2) => `${p1}${process.env.DB_PASSWORD}${p2}`);
exports.db = new pg_1.Pool({
    connectionString,
});
exports.db.connect()
    .then(() => console.log("Connected to PostgreSQL"))
    .catch(err => console.error("DB connection error:", err));
