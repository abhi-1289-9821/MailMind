'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for AES-GCM
const PREFIX = 'enc:v1:';

/**
 * Derive a 32-byte encryption key from the environment variable or fallback secret.
 */
function getEncryptionKey() {
  const secret = process.env.TOKEN_ENCRYPTION_SECRET || process.env.GOOGLE_CLIENT_SECRET || 'mailmind-secure-encryption-key-2026';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext token using AES-256-GCM.
 *
 * @param {string|null|undefined} text
 * @returns {string|null} Encrypted string prefixed with enc:v1: or null
 */
function encryptToken(text) {
  if (!text || typeof text !== 'string') return text ?? null;
  // If already encrypted, avoid double encryption
  if (text.startsWith(PREFIX)) return text;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a token encrypted with encryptToken.
 * Gracefully returns the original string if it is not in encrypted format (backward-compatible).
 *
 * @param {string|null|undefined} cipherText
 * @returns {string|null} Decrypted plaintext token
 */
function decryptToken(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return cipherText ?? null;
  if (!cipherText.startsWith(PREFIX)) {
    // Unencrypted legacy token — return directly
    return cipherText;
  }

  try {
    const raw = cipherText.slice(PREFIX.length);
    const [ivHex, authTagHex, encryptedHex] = raw.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) {
      return cipherText;
    }

    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[crypto] Decryption failed for token:', err.message);
    return cipherText;
  }
}

module.exports = {
  encryptToken,
  decryptToken,
  PREFIX,
};
