require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');

const webhookRoutes = require('./routes/webhooks');
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');
const webhookLogRoutes = require('./routes/webhookLogs');
const { syncShipments } = require('./jobs/syncShipments');

// Express 4 doesn't forward a rejected async handler's promise anywhere, so an
// unhandled rejection anywhere in the process would otherwise crash the whole
// server. These are a last-resort net; every route is also wrapped in
// asyncHandler (see lib/asyncHandler.js) so real request errors reach the
// client as a 500 instead of taking the process down.
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION — process would previously have crashed here:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const app = express();

// Render sits behind a reverse proxy — trust its X-Forwarded-For so rate
// limiting sees the real client IP, not Render's.
app.set('trust proxy', 1);

// CORS_ORIGIN accepts a comma-separated list, e.g. "http://localhost:5500,https://ops.example.com"
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
}));
// Captures the raw body alongside the parsed JSON — needed to verify Nextopper's webhook signature.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/webhook-logs', webhookLogRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4100;
const server = app.listen(PORT, () => {
  console.log(`Box & Beyond API listening on http://localhost:${PORT}`);

  const cron = require('node-cron');
  const intervalMinutes = Number(process.env.DTDC_SYNC_INTERVAL_MINUTES || 15);
  cron.schedule(`*/${intervalMinutes} * * * *`, () => {
    syncShipments().catch(err => console.error('[syncShipments] Job failed:', err));
  });
  console.log(`[syncShipments] Scheduled every ${intervalMinutes} minute(s).`);
});

// Let in-flight requests finish instead of severing them when Render restarts
// or spins the service down.
function shutdown(signal) {
  console.log(`${signal} received, closing server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
