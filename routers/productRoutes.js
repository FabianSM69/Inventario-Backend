import express from 'express';
import { getAllProducts, createProduct } from '../controller/productController.js';
import authMiddleware from './authMiddleware.js';

const router = express.Router();

router.get('/', getAllProducts);
router.post('/', authMiddleware, createProduct);

export default router;