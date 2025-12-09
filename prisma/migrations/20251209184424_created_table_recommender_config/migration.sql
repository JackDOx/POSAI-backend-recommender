-- CreateTable
CREATE TABLE "RecommenderConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "metric" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommenderConfig_pkey" PRIMARY KEY ("id")
);
