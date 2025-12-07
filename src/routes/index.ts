import { Router } from 'express';
import { syncShopifyOrders } from '../controllers/getShopifyOrders';
import { getShopifyProducts } from '../controllers/getShopifyProducts';
import { getLocalProducts } from '../controllers/getLocalProducts';
import { getLocalOrders } from '../controllers/getLocalOrders';
import { rebuildVariantSimilarity } from '../controllers/rebuildVariantSimilarity';
import { getRecommendations } from '../controllers/getRecommendations';
import { getVariantSimilarities } from "../controllers/getAllVariants";

const router = Router();

router.get('/orders', syncShopifyOrders);
router.get('/products', getShopifyProducts);
router.get('/local-products', getLocalProducts);
router.get('/local-orders', getLocalOrders);
router.post('/rebuild-variant-similarity', rebuildVariantSimilarity);
router.post('/recommendations', getRecommendations);
router.get('/variant-similarities', getVariantSimilarities);

export default router;