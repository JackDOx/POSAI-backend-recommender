# POSAI-backend-recommender

Run: docker compose up -d
Stop: docker compose down
Stop + delete db: docker compose down -v

Run server: npm run dev

Prisma DB Migration: npx prisma migrate dev --name init
Format: npx prisma migrate dev --name <name>
