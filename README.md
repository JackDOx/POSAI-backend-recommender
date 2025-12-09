# POSAI Recommender Backend

Backend service for a **POS AI Upsell Assistant**.  
It ingests Shopify orders & products, builds an **item–item recommender**, auto-tunes its scoring metric, and exposes a simple API the POS frontend/extension can call to get:

> “Customers who bought items in this cart also bought…”

This repo covers **data ingestion, recommender training & evaluation, APIs, and deployment infrastructure** (Docker + AWS).

---

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Core Features](#core-features)
- [Architecture](#architecture)
  - [Data Flow](#data-flow)
  - [Data Model](#data-model)
- [Recommender System](#recommender-system)
  - [Basket Construction](#basket-construction)
  - [Co-occurrence Statistics](#co-occurrence-statistics)
  - [Similarity Metrics](#similarity-metrics)
  - [Offline Training & Metric Selection](#offline-training--metric-selection)
  - [Online Recommendation Logic](#online-recommendation-logic)
- [API Reference](#api-reference)
  - [POST `/api/recommendations`](#post-apirecommendations)
  - [Dev / Maintenance Endpoints](#dev--maintenance-endpoints)
- [Local Development](#local-development)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Running with Docker](#running-with-docker)
  - [Database Migrations](#database-migrations)
  - [Running the Server](#running-the-server)
  - [Training the Recommender](#training-the-recommender)
- [Production Deployment (AWS)](#production-deployment-aws)
  - [Networking Layout](#networking-layout)
  - [Core AWS Services](#core-aws-services)
  - [Deployment Flow](#deployment-flow)
  - [Scaling & Reliability](#scaling--reliability)
- [Extensibility](#extensibility)
- [Future Work](#future-work)
- [Quick Commands Recap](#quick-commands-recap)

---

## High-Level Overview

**Goal:** Given a cart (list of Shopify variant IDs), return up to 2 recommended variants that are most likely to be bought together with those items.

The backend:

1. **Ingests data from Shopify**

   - Products → `ProductVariant` table
   - Orders & line items → `OrderLineItem` table

2. **Builds an item–item collaborative filter** using order history:

   - Tracks how often variants are purchased together.
   - Computes statistics required for multiple similarity metrics.

3. **Evaluates several similarity metrics** (co-occurrence, cosine, confidence, lift) on historical data and chooses the best metric automatically.

4. **Stores configuration** (chosen metric) in the DB (`RecommenderConfig`).

5. **Serves lightweight recommendations via REST** for a POS extension.

---

## Core Features

- **Shopify-based item–item collaborative filtering**
- **Multiple scoring metrics**:
  - Raw co-occurrence
  - Cosine similarity
  - Confidence (P(B|A))
  - Lift
- **Offline evaluation and auto-selection of best metric**
  - HitRate@K
  - Precision@K
  - Recall@K
- **Simple REST API** to request recommendations based on cart variants.
- **PostgreSQL + Prisma** data layer.
- **Dockerized** for local dev and production.
- **Cloud-ready**: designed to run behind load balancers on ECS Fargate (+ RDS).

---

## Architecture

### Data Flow

**End-to-end pipeline:**

```text
Shopify Store
   |
   |  (Admin API)
   v
[Data Ingestion]
 - Products         → ProductVariant
 - Orders/LineItems → OrderLineItem
   |
   |  (Offline training script)
   v
[Recommender Training]
 - Builds variantCounts, pairCounts, adjacency
 - Evaluates metrics (cooccurrence / cosine / confidence / lift)
 - Saves best metric → RecommenderConfig
   |
   |  (HTTP request from POS extension)
   v
[Recommendation API]
 - Reads RecommenderConfig.metric
 - Queries VariantSimilarity + ProductVariant
 - Returns top-K upsell items
```

### Data Model

Prisma models (simplified):

```prisma
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  name  String
}

// One row per Shopify **variant**
model ProductVariant {
  id                BigInt @id   // Shopify variant ID
  productId         BigInt       // Shopify product ID

  productTitle      String       // product-level title (p.title)
  variantTitle      String       // variant-level title (v.title)

  price             String
  inventoryQuantity Int
}

// One row per Shopify **line item**
model OrderLineItem {
  id            String   @id                // Shopify line_items[i].id
  orderId       String                       // order.id
  orderNumber   Int                          // order.order_number
  orderName     String                       // order.name like "#1001"
  createdAt     DateTime                     // order.created_at
  currency      String

  productId     String?                      // line_item.product_id
  variantId     String?                      // line_item.variant_id

  lineItemTitle String
  quantity      Int
  price         String
  sku           String?
  isCustomSale  Boolean                      // _shopify_item_type = custom_sale
}

// Item-item co-occurrence matrix
model VariantSimilarity {
  id              Int    @id @default(autoincrement())
  sourceVariantId String
  targetVariantId String
  coCount         Int

  @@index([sourceVariantId])
  @@index([targetVariantId])
}

// Stores global recommender config (chosen metric, etc.)
model RecommenderConfig {
  id        Int      @id @default(1)
  metric    String
  updatedAt DateTime @updatedAt
}
```

**Key points:**

- `ProductVariant` holds product metadata + inventory.
- `OrderLineItem` is the atomic unit for orders; we reconstruct “baskets” (sets of variant IDs per order) from this.
- `VariantSimilarity` stores pairwise counts: how many orders contain both A and B.
- `RecommenderConfig.metric` tells the API which metric to use.

---

## Recommender System

### Basket Construction

In `src/ai/trainRecommender.ts`:

We query all line items:

```sql
SELECT
  oi."orderId"   AS order_id,
  oi."createdAt" AS created_at,
  oi."variantId"::text AS variant_id
FROM "OrderLineItem" oi
ORDER BY oi."createdAt" ASC;
```

Group rows by `order_id` → one basket per order:

```ts
interface OrderBasket {
  orderId: string;
  createdAt: Date;
  variants: string[]; // unique variant IDs in that order
}
```

We keep all orders with ≥ 1 item, so single-item orders contribute to the individual variant counts (important for cosine, confidence, lift), even though they do not create new pairs by themselves.

### Co-occurrence Statistics

From the training set, we build:

```ts
interface Stats {
  numTrainOrders: number;
  variantCounts: Map<VariantId, number>; // how many orders include this variant
  pairCounts: Map<string, number>; // key: "a|b" (a < b), value: co-occurrence count
  adjacency: Map<VariantId, Set<VariantId>>; // neighbors for each variant
}
```

For each order:

- For each variant `v` in the basket:

  - `variantCounts[v] += 1`

- For each unordered pair `(a, b)` in the basket:

  - `pairCounts["a|b"] += 1`
  - `adjacency[a].add(b)` and `adjacency[b].add(a)`

These stats are the foundation for all similarity metrics.

### Similarity Metrics

Let:

- `co = pairCounts[a,b]` = number of orders containing both **A** and **B**.
- `countA = variantCounts[a]`, `countB = variantCounts[b]`.
- `N = numTrainOrders`.

We support four metrics:

#### Co-occurrence

```text
score(A,B) = co
```

Pure frequency of A and B together. Favors very popular pairs.

#### Cosine Similarity

```text
score(A,B) = co / sqrt(countA * countB)
```

Normalizes by how common A and B are individually. Downweights very popular “generic” items.

#### Confidence (P(B|A))

```text
score(A,B) = co / countA
```

“If the customer has A, how often do they also have B?”
Directional: good for rule-like recommendations (e.g., “if shampoo → conditioner”).

#### Lift

```text
P(A)      = countA / N
P(B)      = countB / N
P(A,B)    = co / N
lift(A,B) = P(A,B) / (P(A) * P(B))
```

Measures how much A and B co-occur beyond random chance.
If `lift > 1`, they co-occur more often than expected.

### Offline Training & Metric Selection

Script: `src/ai/trainRecommender.ts`
Run via:

```bash
npm run train:recommender
```

**Pipeline:**

1. Fetch orders → build baskets.

2. Train/validation split (time-based, 80/20):

   ```ts
   const { train, val } = trainTestSplitByTime(baskets, 0.8);
   ```

3. Build stats from train set: `variantCounts`, `pairCounts`, `adjacency`.

4. Evaluate each metric using leave-one-out on validation orders:

   - For each order with ≥ 2 items:

     - `cart =` all items except the last
     - `heldOut =` last item
     - Ask recommender for top-K (K = 2) based on `cart`.
     - Compare recommendations to `heldOut` items.

5. Metrics:

   - **HitRate@K** – fraction of orders where at least one held-out item appears in the top-K.
   - **Precision@K** – on average, what fraction of recommended items are actually correct?
   - **Recall@K** – on average, what fraction of held-out items are recovered?

6. Select best metric (by highest HitRate@2 by default):

   ```ts
   let best = results[0];
   for (const r of results.slice(1)) {
     if (r.hitRateAtK > best.hitRateAtK) best = r;
   }
   ```

7. Persist configuration:

   ```sql
   INSERT INTO "RecommenderConfig" ("id", "metric")
   VALUES (1, $1)
   ON CONFLICT ("id")
   DO UPDATE
     SET "metric" = EXCLUDED."metric",
         "updatedAt" = NOW();
   ```

This is then used by the online API to decide which scoring strategy is active.

### Online Recommendation Logic

Endpoint: `POST /api/recommendations`

1. Read `cartVariantIds` from request body.
2. Look up the active metric from `RecommenderConfig`.
3. Query `VariantSimilarity` to collect candidate targets and aggregate scores across all items in the cart.

Simplified SQL (currently using `coCount`; can later swap to other metrics):

```sql
WITH candidate_scores AS (
  SELECT
    vs."targetVariantId" AS "variantId",
    SUM(vs."coCount") AS score
  FROM "VariantSimilarity" vs
  WHERE vs."sourceVariantId" = ANY($1::text[])
    AND NOT (vs."targetVariantId" = ANY($1::text[]))
  GROUP BY vs."targetVariantId"
)
SELECT
  cs."variantId",
  cs.score,
  pv."productId",
  pv."productTitle",
  pv."variantTitle",
  pv.price,
  pv."inventoryQuantity"
FROM candidate_scores cs
JOIN "ProductVariant" pv
  ON pv."id"::text = cs."variantId"
WHERE pv."inventoryQuantity" > 0
ORDER BY cs.score DESC, pv."productTitle" ASC
LIMIT 2;
```

**Multi-item cart support:**

- For each `sourceVariantId` in the cart, we pick all neighbors (`targetVariantId`) from `VariantSimilarity`.
- Scores from multiple cart items are summed for each target.
- Items already in the cart are excluded.

This means:

- If A, B, C are in the cart, and they all point to D, D’s score is high and will likely be recommended.
- If only A points to E, E’s score might still win if `coCount(A, E)` is strong.

---

## API Reference

### POST `/api/recommendations`

**Description:**
Given a list of variant IDs in the cart, return up to 2 recommended variants.

**Request Body:**

```json
{
  "cartVariantIds": ["46812312961178", "46812312633498"]
}
```

(Your POS extension can map Shopify line items → variant IDs and send them in this array.)

**Response:**

```json
{
  "metric": "cooccurrence",
  "recommendations": [
    {
      "variantId": "46812313000000",
      "score": 3,
      "productId": "1234567890",
      "productTitle": "The Multi-location Snowboard",
      "variantTitle": "Default Title",
      "price": "199.00",
      "inventoryQuantity": 42
    },
    {
      "variantId": "46812313000001",
      "score": 2,
      "productId": "2345678901",
      "productTitle": "Selling Plans Ski Wax",
      "variantTitle": "Special Selling Plans Ski Wax",
      "price": "15.00",
      "inventoryQuantity": 10
    }
  ]
}
```

If no recommendation is found (e.g., new store with minimal data), you’ll get:

```json
{
  "metric": "cooccurrence",
  "recommendations": []
}
```

### Dev / Maintenance Endpoints

These are meant for internal/admin use during development.

#### Sync Shopify products

`GET /api/shopify/products`

Fetches products from Shopify and upserts into `ProductVariant`.

#### Sync Shopify orders

`GET /api/shopify/orders`

Fetches orders and line items from Shopify and upserts into `OrderLineItem`.

#### (Optional) Rebuild `VariantSimilarity`

If you keep a helper endpoint:

```ts
// DEV-ONLY: recompute VariantSimilarity from scratch
export async function rebuildVariantSimilarity(req: Request, res: Response) {
  await getShopifyProducts(req, res);
  await syncShopifyOrders(req, res);
  await db.query(`TRUNCATE TABLE "VariantSimilarity"`);
  await db.query(`
    INSERT INTO "VariantSimilarity" ("sourceVariantId", "targetVariantId", "coCount")
    SELECT
      li1."variantId" AS "sourceVariantId",
      li2."variantId" AS "targetVariantId",
      COUNT(DISTINCT li1."orderId") AS "coCount"
    FROM "OrderLineItem" li1
    JOIN "OrderLineItem" li2
      ON li1."orderId" = li2."orderId"
     AND li1."variantId" <> li2."variantId"
    WHERE li1."variantId" IS NOT NULL
      AND li2."variantId" IS NOT NULL
    GROUP BY li1."variantId", li2."variantId";
  `);
  res.json({ ok: true });
}
```

---

## Local Development

### Prerequisites

- Node.js 20+
- npm
- Docker & Docker Compose
- A `.env` file with DB + Shopify credentials (example below)

### Environment Variables

Example `.env` (local dev):

```env
# Postgres
DATABASE_URL=postgresql://posai:posai@localhost:5432/posai

# Server
PORT=3000
NODE_ENV=development

# Shopify (example – adjust to your config)
SHOPIFY_STORE_DOMAIN=my-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxx
```

In Docker, the service uses:

```env
DATABASE_URL=postgresql://posai:posai@postgres:5432/posai
```

(where `postgres` is the Docker service name).

### Running with Docker

`docker-compose.yml`:

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16
    container_name: posai-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: posai
      POSTGRES_PASSWORD: posai
      POSTGRES_DB: posai
    ports:
      - "5432:5432"
    volumes:
      - posai_pg_data:/var/lib/postgresql/data

  api:
    build: .
    container_name: posai-recommender
    restart: unless-stopped
    depends_on:
      - postgres
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://posai:posai@postgres:5432/posai
    ports:
      - "3000:3000"

volumes:
  posai_pg_data:
```

Commands:

```bash
# Start Postgres + API
docker compose up --build

# Stop
docker compose down

# Stop + delete DB volume
docker compose down -v
```

### Database Migrations

Using Prisma:

```bash
# Create / update DB schema
npx prisma migrate dev --name init

# Subsequent migrations
npx prisma migrate dev --name <name>

# Regenerate Prisma client
npx prisma generate
```

### Runnin
