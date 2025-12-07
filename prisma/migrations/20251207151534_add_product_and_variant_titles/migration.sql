/*
  Warnings:

  - You are about to drop the column `title` on the `ProductVariant` table. All the data in the column will be lost.
  - Added the required column `productTitle` to the `ProductVariant` table without a default value. This is not possible if the table is not empty.
  - Added the required column `variantTitle` to the `ProductVariant` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProductVariant" DROP COLUMN "title",
ADD COLUMN     "productTitle" TEXT NOT NULL,
ADD COLUMN     "variantTitle" TEXT NOT NULL;
