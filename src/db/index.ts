import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();


// Replace both the username and password in the DATABASE_URL with DB_USER and DB_PASSWORD from .env
let connectionString = process.env.DATABASE_URL;
if (connectionString && process.env.DB_USER && process.env.DB_PASSWORD) {
  connectionString = connectionString.replace(
    /(postgres(?:ql)?:\/\/)[^:]+:[^@]+(@.*)/,
    (_match, p1, p2) => `${p1}${process.env.DB_USER}:${process.env.DB_PASSWORD}${p2}`
  );
}

console.log("MY CONNECTION STRING:" ,connectionString);
export const db = new Pool({
  connectionString,
});

db.connect()
  .then(() => console.log("Connected to PostgreSQL"))
  .catch(err => console.error("DB connection error:", err));