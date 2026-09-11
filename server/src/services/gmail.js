'use strict';

const { google } = require('googleapis');
const { db } = require('../db');
const { getAuthorizedClient } = require('../auth/google');

// ─── MIME helpers ─────────────────────────────────────────────────────────────

/**
 * Recursively walk a Gmail MIME message tree.
 * Returns { text, hasAttachment } where `text` is the best available plain body.
 *
 * Priority:
 *   1. text/plain part
 *   2. text/html part stripped of tags (fallback)
 */
function extractBody(payload) {
  let plainText = null;
  let htmlText = null;
  let hasAttachment = false;

  function walk(part) {
    if (!part) return;

    const mime = part.mimeType || '';

    // Leaf: disposition = attachment
    if (
      part.filename &&
      part.filename.length > 0 &&
      part.body?.size > 0
    ) {
      hasAttachment = true;
      return;
    }

    // Leaf: text/plain
    if (mime === 'text/plain' && part.body?.data) {
      plainText = decodeBase64Url(part.body.data);
      return;
    }

    // Leaf: text/html
    if (mime === 'text/html' && part.body?.data) {
      htmlText = stripHtml(decodeBase64Url(part.body.data));
      return;
    }

    // Container: recurse into parts
    if (part.parts && Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  }

  walk(payload);

  const text = plainText || htmlText || '';
  return { text: text.trim(), hasAttachment };
}

function decodeBase64Url(encoded) {
  // Gmail uses URL-safe base64 (replaces + with - and / with _)
  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standard, 'base64').toString('utf-8');
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Header helper ────────────────────────────────────────────────────────────

function getHeader(headers, name) {
  const h = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return h ? h.value : null;
}

// ─── Prepared statements (created once, reused) ───────────────────────────────

const stmtUpsertEmail = db.prepare(`
  INSERT INTO emails (id, thread_id, user_email, subject, sender, recipient, date_sent, body, has_attachment)
  VALUES (@id, @threadId, @userEmail, @subject, @sender, @recipient, @dateSent, @body, @hasAttachment)
  ON CONFLICT(id) DO NOTHING
`);

const stmtEmailExists = db.prepare('SELECT id FROM emails WHERE id = ?');

// ─── Main service function ────────────────────────────────────────────────────

/**
 * Fetch emails from Gmail and store new ones in SQLite.
 *
 * @param {string} userEmail   - The authenticated user's Gmail address
 * @param {number} limit       - Max messages to fetch (default from env)
 * @returns {{ fetched: number, inserted: number, skipped: number }}
 */
async function fetchAndStoreEmails(
  userEmail,
  limit = parseInt(process.env.GMAIL_FETCH_LIMIT ?? '200', 10)
) {
  const authClient = getAuthorizedClient(userEmail);
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  // Step 1: List message IDs (lightweight — no body)
  console.log(`[gmail] Listing up to ${limit} messages for ${userEmail}…`);
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    maxResults: limit,
  });

  const messageRefs = listRes.data.messages || [];
  if (messageRefs.length === 0) {
    return { fetched: 0, inserted: 0, skipped: 0 };
  }

  // Step 2: Filter out IDs already in the DB before making expensive API calls
  const toFetch = messageRefs.filter(({ id }) => !stmtEmailExists.get(id));
  const skipped = messageRefs.length - toFetch.length;

  console.log(
    `[gmail] ${messageRefs.length} listed, ${skipped} already stored, ` +
    `${toFetch.length} to fetch`
  );

  // Step 3: Fetch full message payloads (sequential to avoid rate-limit 429s)
  //         In Phase 5+ this can be parallelised with a concurrency limiter.
  let inserted = 0;

  // Wrap all inserts in a transaction for atomicity and performance
  const insertBatch = db.transaction((messages) => {
    for (const msg of messages) {
      const headers = msg.payload?.headers || [];
      const dateHeader = getHeader(headers, 'Date');
      const dateSent = dateHeader ? Math.floor(new Date(dateHeader).getTime() / 1000) : null;

      const { text, hasAttachment } = extractBody(msg.payload || {});

      stmtUpsertEmail.run({
        id:            msg.id,
        threadId:      msg.threadId,
        userEmail,
        subject:       getHeader(headers, 'Subject'),
        sender:        getHeader(headers, 'From'),
        recipient:     getHeader(headers, 'To'),
        dateSent,
        body:          text,
        hasAttachment: hasAttachment ? 1 : 0,
      });

      inserted++;
    }
  });

  // Fetch in chunks of 5 with pacing and retry to respect Gmail API quotas
  const CHUNK = 5;
  for (let i = 0; i < toFetch.length; i += CHUNK) {
    const chunk = toFetch.slice(i, i + CHUNK);
    const fetched = await Promise.all(
      chunk.map(async ({ id }) => {
        let lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
            return res.data;
          } catch (err) {
            lastErr = err;
            if (err?.code === 429 || err?.message?.includes('Quota exceeded')) {
              console.warn(`[gmail] Rate limit hit on message ${id}, waiting before retry (attempt ${attempt}/3)...`);
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            } else {
              throw err;
            }
          }
        }
        throw lastErr;
      })
    );
    insertBatch(fetched);
    console.log(`[gmail] Stored ${Math.min(i + CHUNK, toFetch.length)}/${toFetch.length}`);

    // Small delay between chunks to stay safely below the quota units limit
    if (i + CHUNK < toFetch.length) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  return { fetched: messageRefs.length, inserted, skipped };
}

module.exports = { fetchAndStoreEmails };
