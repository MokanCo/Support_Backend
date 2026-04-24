import { Router } from 'express';
import * as authController from '../controllers/authController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validate.js';
import { loginValidators } from '../utils/validators.js';

const router = Router();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in
 *     description: Validates credentials and returns a JWT and user profile. Use the token as `Authorization Bearer` on subsequent requests.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           examples:
 *             admin:
 *               summary: Admin example
 *               value:
 *                 email: admin@mokanco.example
 *                 password: ChangeMe123!
 *     responses:
 *       200:
 *         description: Authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *             example:
 *               token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example
 *               user:
 *                 id: "64a1b2c3d4e5f6789012345"
 *                 name: System Admin
 *                 email: admin@mokanco.example
 *                 role: admin
 *                 locationId: null
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *             example:
 *               success: false
 *               message: Valid email is required
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *             example:
 *               success: false
 *               message: Invalid credentials
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.post('/login', loginValidators, validateRequest, authController.login);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Sign out (client-side)
 *     description: Stateless JWT — clears nothing server-side; clients should discard the token. Optional Bearer token.
 *     security: []
 *     responses:
 *       200:
 *         description: Acknowledged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 */
router.post('/logout', authController.logout);

/**
 * @swagger
 * /api/auth/currentUser:
 *   get:
 *     tags: [Auth]
 *     summary: Current user
 *     description: Returns the authenticated user and their location (if any).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MeResponse'
 *       401:
 *         description: Missing or invalid Bearer token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorMessage'
 */
router.get('/currentUser', authMiddleware, authController.me);

export default router;
