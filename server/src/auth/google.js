'use strict';

const { google } = require('googleapis');
const { db } = require('../db');
const { encryptToken, decryptToken } = require('../utils/crypto');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * Create a base OAuth2 client from env vars.
 * Do NOT call this with credentials attached — use getAuthorizedClient() for that.
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Returns the Google consent page URL.
 * access_type=offline → we get a refresh token on first consent.
 * prompt=consent      → forces the consent screen even if the user previously
 *                        approved, ensuring we always receive a fresh refresh token.
 */
function getAuthUrl() {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

/**
 * Exchange an authorization code for tokens.
 * Fetches the user's email address, then upserts tokens into oauth_tokens.
 *
 * @param {string} code - The code query param from /auth/callback
 * @returns {{ email: string }} The authenticated user's email
 */
async function exchangeCode(code) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Fetch the authenticated user's email
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  const email = data.email;

  if (!email) {
    throw new Error('Could not retrieve email from Google userinfo endpoint');
  }

  // Upsert tokens with AES-256-GCM encryption at rest
  const upsert = db.prepare(`
    INSERT INTO oauth_tokens (user_email, refresh_token, access_token, token_expiry, updated_at)
    VALUES (@email, @refreshToken, @accessToken, @tokenExpiry, strftime('%s','now'))
    ON CONFLICT(user_email) DO UPDATE SET
      refresh_token = excluded.refresh_token,
      access_token  = excluded.access_token,
      token_expiry  = excluded.token_expiry,
      updated_at    = strftime('%s','now')
  `);

  upsert.run({
    email,
    refreshToken: encryptToken(tokens.refresh_token),
    accessToken:  encryptToken(tokens.access_token ?? null),
    tokenExpiry:  tokens.expiry_date ?? null,
  });

  return { email };
}

/**
 * Load a stored refresh token from SQLite and return a ready-to-use OAuth2 client.
 *
 * @param {string} userEmail
 * @returns {import('googleapis').Auth.OAuth2Client}
 */
function getAuthorizedClient(userEmail) {
  const row = db.prepare(
    'SELECT refresh_token, access_token, token_expiry FROM oauth_tokens WHERE user_email = ?'
  ).get(userEmail);

  if (!row) {
    throw new Error(`No stored tokens for ${userEmail}. Complete OAuth flow first.`);
  }

  const client = createOAuth2Client();
  client.setCredentials({
    refresh_token: decryptToken(row.refresh_token),
    access_token:  decryptToken(row.access_token) ?? undefined,
    expiry_date:   row.token_expiry ?? undefined,
  });

  // Persist any auto-refreshed tokens back to the DB encrypted
  client.on('tokens', (newTokens) => {
    const update = db.prepare(`
      UPDATE oauth_tokens
      SET access_token = @accessToken,
          token_expiry = @tokenExpiry,
          updated_at   = strftime('%s','now')
      WHERE user_email = @email
    `);
    update.run({
      accessToken: encryptToken(newTokens.access_token ?? decryptToken(row.access_token)),
      tokenExpiry: newTokens.expiry_date ?? row.token_expiry,
      email:       userEmail,
    });
  });

  return client;
}

/**
 * Check whether we have a refresh token stored for the given email.
 */
function isAuthorized(userEmail) {
  const row = db.prepare(
    'SELECT id FROM oauth_tokens WHERE user_email = ?'
  ).get(userEmail);
  return !!row;
}

module.exports = { getAuthUrl, exchangeCode, getAuthorizedClient, isAuthorized };
