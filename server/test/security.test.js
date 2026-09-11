'use strict';

/**
 * Automated Security & Authentication Test Suite for MailMind Server.
 * Verifies:
 * 1. AES-256-GCM token encryption and decryption roundtrip.
 * 2. Legacy plaintext token backward compatibility.
 * 3. HMAC-SHA256 session token generation, verification, and tamper resistance.
 * 4. User impersonation prevention and identity matching.
 */

const assert = require('assert');
const { encryptToken, decryptToken, PREFIX } = require('../src/utils/crypto');
const { signSessionToken, verifySessionToken, requireAuth } = require('../src/middleware/auth');

console.log('='.repeat(70));
console.log('🔒 Running MailMind Server Security Test Suite');
console.log('='.repeat(70));

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

// ─── 1. Crypto & Token Encryption Tests ──────────────────────────────────────

test('Token encryption produces prefixed ciphertext', () => {
  const plainToken = 'ya29.a0ARrdaM8sample_refresh_token_string_here_12345';
  const encrypted = encryptToken(plainToken);

  assert(encrypted !== plainToken, 'Encrypted token should not equal plaintext');
  assert(encrypted.startsWith(PREFIX), `Encrypted token should start with prefix ${PREFIX}`);
});

test('Token decryption restores original plaintext accurately', () => {
  const plainToken = '1//04sample_refresh_token_very_long_and_secret';
  const encrypted = encryptToken(plainToken);
  const decrypted = decryptToken(encrypted);

  assert.strictEqual(decrypted, plainToken, 'Decrypted token must match original plaintext');
});

test('Legacy plaintext tokens are handled gracefully without decryption errors', () => {
  const legacyToken = 'legacy_plaintext_oauth_token_from_older_version';
  const decrypted = decryptToken(legacyToken);

  assert.strictEqual(decrypted, legacyToken, 'Legacy unencrypted tokens should pass through intact');
});

test('Null and undefined tokens return gracefully', () => {
  assert.strictEqual(encryptToken(null), null);
  assert.strictEqual(decryptToken(null), null);
  assert.strictEqual(encryptToken(undefined), null);
});

// ─── 2. Session & Auth Verification Tests ────────────────────────────────────

test('Session token is generated and verified with matching email', () => {
  const email = 'user@example.com';
  const token = signSessionToken(email);

  assert(typeof token === 'string' && token.includes('.'), 'Token must be a two-part signed string');

  const result = verifySessionToken(token);
  assert.strictEqual(result.valid, true, 'Valid token should pass verification');
  assert.strictEqual(result.email, email, 'Decoded email must match original');
});

test('Tampered token payload or signature is rejected', () => {
  const email = 'legit_user@example.com';
  const token = signSessionToken(email);
  const [payload, sig] = token.split('.');

  // Tamper with signature
  const tamperedSigToken = `${payload}.${sig.slice(0, -4)}xxxx`;
  const result = verifySessionToken(tamperedSigToken);
  assert.strictEqual(result.valid, false, 'Tampered signature must be rejected');

  // Tamper with payload
  const fakePayload = Buffer.from(JSON.stringify({ email: 'hacker@example.com', iat: 1000, exp: 9999999999 })).toString('base64url');
  const tamperedPayloadToken = `${fakePayload}.${sig}`;
  const result2 = verifySessionToken(tamperedPayloadToken);
  assert.strictEqual(result2.valid, false, 'Tampered payload must be rejected');
});

test('Expired session token is rejected', () => {
  const email = 'user@example.com';
  // Expired 10 seconds ago
  const expiredToken = signSessionToken(email, -10);
  const result = verifySessionToken(expiredToken);

  assert.strictEqual(result.valid, false, 'Expired token must fail verification');
  assert(result.error.includes('expired'), 'Error message should indicate expiration');
});

// ─── 3. Identity Verification & Impersonation Prevention ─────────────────────

test('requireAuth blocks attempt to act on behalf of a different email', () => {
  const callerEmail = 'alice@example.com';
  const victimEmail = 'bob@example.com';
  const token = signSessionToken(callerEmail);

  let statusSent = null;
  let jsonSent = null;

  const req = {
    headers: { authorization: `Bearer ${token}` },
    body: { email: victimEmail, action: 'send_email' },
    query: {},
  };

  const res = {
    status(s) {
      statusSent = s;
      return this;
    },
    json(data) {
      jsonSent = data;
      return this;
    },
  };

  let nextCalled = false;
  requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, false, 'next() should NOT be called on impersonation attempt');
  assert.strictEqual(statusSent, 403, 'Should respond with 403 Forbidden on email mismatch');
  assert(jsonSent.error.includes('Forbidden'), 'Error must inform caller about forbidden identity');
});

test('requireAuth permits request when authenticated email matches requested action', () => {
  const email = 'alice@example.com';
  const token = signSessionToken(email);

  const req = {
    headers: { authorization: `Bearer ${token}` },
    body: { email: 'alice@example.com' },
    query: {},
  };

  let nextCalled = false;
  requireAuth(req, {}, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true, 'next() should be called when identities match');
  assert.strictEqual(req.user.email, email, 'req.user.email must be bound to authenticated identity');
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('='.repeat(70));
console.log(`Security Test Results: ${passed}/${total} Passed (${Math.round((passed / total) * 100)}%)`);
console.log('='.repeat(70));

if (passed !== total) {
  process.exit(1);
}
