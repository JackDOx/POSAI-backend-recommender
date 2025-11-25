import { Router } from 'express';
import { testEndpoint } from '../controllers/testController';

const router = Router();

router.get('/test', testEndpoint);

export default router;