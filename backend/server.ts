import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import adminRoutes from './src/routes/admin.ts';
import authRoutes from './src/routes/auth.ts';
import bookingRoutes from './src/routes/bookings.ts';
import resourceRoutes from './src/routes/resources.ts';
import ticketRoutes from './src/routes/tickets.ts';
import { sendApiError } from './src/lib/errors.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createAppServer() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/resources', resourceRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api', adminRoutes);

  app.use('/api', (_req, res) => {
    sendApiError(res, 404, 'NOT_FOUND', 'API endpoint not found.');
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, '..', 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`ResolveGrid server listening on http://0.0.0.0:${port}`);
  });
}

createAppServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
