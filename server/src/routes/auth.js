'use strict';

const express = require('express');
const { getAuthUrl, exchangeCode, isAuthorized } = require('../auth/google');

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
 * Phase 6 change: redirect to React app URL instead of JSON response.
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
    return res.redirect(`http://localhost:3000?authed=1&email=${encodeURIComponent(email)}`);
  } catch (err) {
    console.error('[auth/callback]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /auth/status?email=...
 * Returns whether we have stored tokens for the given email.
 * Used by the React UI (Phase 6) to decide whether to show the login button.
 */
router.get('/status', (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'email query param required' });
  }
  const authed = isAuthorized(email);
  return res.json({ authed, authorized: authed, email });
});

module.exports = router;
