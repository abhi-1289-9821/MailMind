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

// ─── Startup Security Validation ─────────────────────────────────────────────
/**
 * Validates that all required security secrets are explicitly configured.
 * Terminates the process immediately if any required secret is missing or still
 * set to a placeholder value. This prevents the server from starting with known
 * or predictable keys that could allow token forgery or token decryption.
 */
function validateSecrets() {
  const errors = [];

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) {
    errors.push('  SESSION_SECRET is not set.');
  } else if (SESSION_SECRET.startsWith('your-') || SESSION_SECRET === 'mailmind-session-auth-secret-key') {
    errors.push('  SESSION_SECRET is still a placeholder value. Generate a real secret (e.g. openssl rand -hex 32).');
  }

  const TOKEN_ENCRYPTION_SECRET = process.env.TOKEN_ENCRYPTION_SECRET;
  if (!TOKEN_ENCRYPTION_SECRET) {
    errors.push('  TOKEN_ENCRYPTION_SECRET is not set.');
  } else if (TOKEN_ENCRYPTION_SECRET.startsWith('your-') || TOKEN_ENCRYPTION_SECRET === 'mailmind-secure-encryption-key-2026') {
    errors.push('  TOKEN_ENCRYPTION_SECRET is still a placeholder value. Generate a real secret (e.g. openssl rand -hex 32).');
  }

  if (errors.length > 0) {
    console.error('\n\u274C  [startup] Missing or insecure required secrets. Server will not start.\n');
    errors.forEach((e) => console.error(e));
    console.error('\n  Add these to server/.env. See server/.env.example for guidance.\n');
    process.exit(1);
  }

  if (process.env.ALLOW_UNAUTHENTICATED_DEV === 'true') {
    console.warn(
      '\n⚠️  [startup] ALLOW_UNAUTHENTICATED_DEV=true is active. '
      + 'Requests without session tokens will be accepted in dev mode. '
      + 'Never use this in production.\n'
    );
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
// Routers are loaded AFTER initDb() so that any module-level db.prepare() calls
// always have a live sql.js instance available (lazy, but safe).

async function start() {
  validateSecrets(); // Guard: will exit(1) if secrets are missing or placeholder values

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
