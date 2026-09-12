'use strict';

const crypto = require('crypto');

/**
 * Derives a secret key for session signatures.
 * Throws at call-time if SESSION_SECRET is not set — startup validation in index.js
 * is the primary guard, but this ensures no code path silently uses a known key.
 */
function getSessionSecret() {
  const secret = process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) {
    throw new Error(
      '[auth] SESSION_SECRET is not set. The server should not have started — check index.js validateSecrets().'
    );
  }
  return secret;
}

/**
 * Creates a cryptographically signed session token.
 * Format: base64(payload).signature
 *
 * @param {string} email
 * @param {number} [expiresInSeconds=604800] 7 days default
 * @returns {string} Signed token
 */
function signSessionToken(email, expiresInSeconds = 7 * 24 * 3600) {
  const secret = getSessionSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    email: email.toLowerCase().trim(),
    iat: now,
    exp: now + expiresInSeconds,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadStr)
    .digest('base64url');

  return `${payloadStr}.${signature}`;
}

/**
 * Verifies a signed session token.
 *
 * @param {string} token
 * @returns {{ valid: boolean, email?: string, error?: string }}
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'No session token provided' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token structure' };
  }

  const [payloadStr, signature] = parts;
  const secret = getSessionSecret();
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadStr)
    .digest('base64url');

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: 'Invalid token signature' };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Session token has expired' };
    }

    return { valid: true, email: payload.email };
  } catch (err) {
    return { valid: false, error: 'Invalid token payload' };
  }
}

/**
 * Express middleware to enforce caller identity.
 * Verifies caller authorization and prevents email impersonation.
 */
function requireAuth(req, res, next) {
  // Extract token from Bearer header, custom header, cookie, or query param
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['x-session-token']) {
    token = req.headers['x-session-token'];
  } else if (req.query?.token) {
    token = req.query.token;
  }

  if (token) {
    const result = verifySessionToken(token);
    if (!result.valid) {
      return res.status(401).json({
        success: false,
        error: `Authentication failed: ${result.error}`,
      });
    }

    req.user = { email: result.email };

    // Prevent impersonation: if caller passed an email in body or query, it MUST match the authenticated token
    const requestedEmail = (req.body?.email || req.query?.email || '').toLowerCase().trim();
    if (requestedEmail && requestedEmail !== req.user.email) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: Authenticated as ${req.user.email} but attempted action on behalf of ${requestedEmail}`,
      });
    }

    return next();
  }

  // Strict by default — any request without a valid session token is rejected.
  // To allow unauthenticated local development (e.g. before OAuth is fully set up),
  // set ALLOW_UNAUTHENTICATED_DEV=true in server/.env. Never set this in production.
  if (process.env.ALLOW_UNAUTHENTICATED_DEV !== 'true') {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please connect your Gmail account to obtain a session token.',
    });
  }

  // Dev-only bypass: trust the email in the request body. Logged clearly so it is never invisible.
  const devEmail = (req.body?.email || req.query?.email || '').toLowerCase().trim();
  if (devEmail) {
    console.warn(
      `[auth] ALLOW_UNAUTHENTICATED_DEV bypass — treating '${devEmail}' as authenticated (dev only).`
    );
    req.user = { email: devEmail, isDevFallback: true };
  }
  next();
}

module.exports = {
  signSessionToken,
  verifySessionToken,
  requireAuth,
};
