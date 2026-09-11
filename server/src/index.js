'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const { initDb } = require('./db');

const app  = express();
const PORT = process.env.PORT ?? 4000;

// ─── Network & CORS Hardening ────────────────────────────────────────────────
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((s) => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy violation: Origin ${origin} is not permitted.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-token'],
}));
app.use(express.json());
app.use(morgan('dev'));

// ─── Bootstrap ────────────────────────────────────────────────────────────────
// Routers are loaded AFTER initDb() so that any module-level db.prepare() calls
// always have a live sql.js instance available (lazy, but safe).

async function start() {
  await initDb(); // loads WASM + schema — must complete before serving requests

  const authRouter  = require('./routes/auth');
  const emailRouter = require('./routes/email');

  app.use('/auth', authRouter);
  app.use('/',     emailRouter);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'gemai-server', phase: 5 });
  });


  // Global error handler
  app.use((err, _req, res, _next) => {
    console.error('[unhandled]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, () => {
    console.log(`\n🚀  GemAI server running on http://localhost:${PORT}`);
    console.log(`   Auth flow: open http://localhost:${PORT}/auth/login in a browser`);
    console.log(`   Health:    GET  http://localhost:${PORT}/health\n`);
  });
}

start().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});

module.exports = app;
