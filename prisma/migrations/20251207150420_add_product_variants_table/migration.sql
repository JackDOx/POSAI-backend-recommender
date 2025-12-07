-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" BIGINT NOT NULL,
    "productId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "inventoryQuantity" INTEGER NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);
