-- CreateTable
CREATE TABLE "VariantSimilarity" (
    "id" SERIAL NOT NULL,
    "sourceVariantId" TEXT NOT NULL,
    "targetVariantId" TEXT NOT NULL,
    "coCount" INTEGER NOT NULL,

    CONSTRAINT "VariantSimilarity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VariantSimilarity_sourceVariantId_idx" ON "VariantSimilarity"("sourceVariantId");

-- CreateIndex
CREATE INDEX "VariantSimilarity_targetVariantId_idx" ON "VariantSimilarity"("targetVariantId");
