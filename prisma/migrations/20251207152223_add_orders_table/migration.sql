-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "orderName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "lineItemTitle" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" TEXT NOT NULL,
    "sku" TEXT,
    "isCustomSale" BOOLEAN NOT NULL,

    CONSTRAINT "OrderLineItem_pkey" PRIMARY KEY ("id")
);
