'use strict';

const express = require('express');
const { getAuthUrl, exchangeCode, isAuthorized } = require('../auth/google');
const { signSessionToken, verifySessionToken } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /auth/login
 * Redirects the browser to Google's OAuth consent page.
 * Open this URL directly in a browser tab — cannot be called via curl.
 */
router.get('/login', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

/**
 * GET /auth/callback
 * Google redirects here with `?code=...` after the user approves.
 * Exchanges the code for tokens and persists the refresh token.
 *
 * Generates a signed session token and redirects to the React app.
 */
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).json({
      success: false,
      error: `Google OAuth error: ${error}`,
    });
  }

  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'Missing authorization code in callback',
    });
  }

  try {
    const { email } = await exchangeCode(code);
    const sessionToken = signSessionToken(email);
    const clientBaseUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    return res.redirect(
      `${clientBaseUrl}?authed=1&email=${encodeURIComponent(email)}&token=${encodeURIComponent(sessionToken)}`
    );
  } catch (err) {
    console.error('[auth/callback]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /auth/status?email=...
 * Returns whether we have stored tokens for the given email.
 */
router.get('/status', (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'email query param required' });
  }
  const authed = isAuthorized(email);
  return res.json({ authed, authorized: authed, email });
});

/**
 * GET /auth/me
 * Validates the caller's session token and returns identity.
 */
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : req.query?.token;

  const result = verifySessionToken(token);
  if (!result.valid) {
    return res.status(401).json({ authenticated: false, error: result.error });
  }

  return res.json({
    authenticated: true,
    email: result.email,
    authorized: isAuthorized(result.email),
  });
});

module.exports = router;
