import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import beeRoutes from './routes/bee';
import bettingRoutes from './routes/betting';
import pollRoutes from './routes/poll';

const app = new Hono<Env>();

// CORS
app.use('/api/*', cors());

// Public auth routes
app.route('/api/auth', authRoutes);

// Protected routes — require JWT
app.use('/api/*', authMiddleware());
app.route('/api/admin', adminRoutes);
app.route('/api/bee', beeRoutes);
app.route('/api/bets', bettingRoutes);
app.route('/api/poll', pollRoutes);

export default app;
