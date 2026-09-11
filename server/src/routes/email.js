'use strict';

const express = require('express');
const { fetchAndStoreEmails, sendEmail } = require('../services/gmail');
const { isAuthorized } = require('../auth/google');
const { recordApproval, db } = require('../db');

const router = express.Router();
const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8000';

// ─── Agent Proxy Helper ───────────────────────────────────────────────────────

async function proxyToAgent(endpoint, body, res) {
  try {
    const response = await fetch(`${AGENT_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (err) {
    console.error(`[proxy ${endpoint}] Error connecting to agent service:`, err.message);
    return res.status(503).json({
      error: 'Agent service is unreachable. Ensure the Python agent is running on port 8000.',
    });
  }
}

// ─── POST /ingest ─────────────────────────────────────────────────────────────
/**
 * Trigger a Gmail fetch for the given user and store results in SQLite.
 *
 * Body: { "email": "user@gmail.com", "limit": 200 }   (limit is optional)
 *
 * Response: { fetched, inserted, skipped }
 */
router.post('/ingest', async (req, res) => {
  const { email, limit } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Request body must include "email"' });
  }

  if (!isAuthorized(email)) {
    return res.status(401).json({
      error: `No stored OAuth tokens for ${email}. Visit GET /auth/login first.`,
    });
  }

  try {
    const fetchResult = await fetchAndStoreEmails(
      email,
      limit ? parseInt(limit, 10) : undefined
    );

    // Step 2: Trigger Python agent to embed newly ingested emails into ChromaDB
    let agentResult = null;
    try {
      const agentRes = await fetch(`${AGENT_URL}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      agentResult = await agentRes.json().catch(() => ({}));
    } catch (agentErr) {
      console.warn('[POST /ingest] Warning: Agent embedding call failed:', agentErr.message);
    }

    return res.json({
      success: true,
      ...fetchResult,
      embedded: agentResult?.embedded ?? 0,
      agentMessage: agentResult?.message,
    });
  } catch (err) {
    const errorMsg = err?.message || String(err);
    console.error('[POST /ingest]', errorMsg);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

// ─── POST /query (and /agent/query) ───────────────────────────────────────────
/**
 * Forward natural language question to the Python LangGraph agent.
 * Transparently returns Python agent status code and response payload.
 *
 * Body: { "email": "...", "question": "..." }
 */
async function handleQuery(req, res) {
  const { email, question } = req.body;
  if (!email || !question) {
    return res.status(400).json({ error: 'Request body must include "email" and "question"' });
  }
  return proxyToAgent('/query', { email, question }, res);
}

router.post('/query', handleQuery);
router.post('/agent/query', handleQuery);

// ─── POST /draft (and /agent/draft) ───────────────────────────────────────────
/**
 * Generate a reply draft using the Python agent's draft node.
 *
 * Body: { "email": "...", "thread_id": "...", "instruction": "..." }
 */
async function handleDraft(req, res) {
  const { email, thread_id, instruction } = req.body;
  if (!email || !thread_id || !instruction) {
    return res.status(400).json({
      error: 'Request body must include "email", "thread_id", and "instruction"',
    });
  }
  return proxyToAgent('/draft', { email, thread_id, instruction }, res);
}

router.post('/draft', handleDraft);
router.post('/agent/draft', handleDraft);

// ─── POST /draft/approve (and /approve-send) ──────────────────────────────────
/**
 * Human-in-the-Loop approval gate:
 * - Records the approved draft in the local audit log.
 * - Directly dispatches the email to the recipient via Gmail API (gmail.send).
 *
 * Body: { "email": "...", "thread_id": "...", "to": "...", "subject": "...", "body": "..." }
 */
async function handleApprove(req, res) {
  const { email, thread_id, to, subject, body } = req.body;

  if (!email || !thread_id || !to || !body) {
    return res.status(400).json({
      error: 'Request body must include "email", "thread_id", "to", and "body"',
    });
  }

  try {
    const auditId = recordApproval({
      threadId: thread_id,
      recipient: to,
      subject: subject || '',
      approvedBy: email,
      bodySnapshot: body,
    });

    console.log(
      `[APPROVAL] Email send approved by ${email} to ${to} for thread ${thread_id} (audit_id: ${auditId})`
    );

    // Send email directly through Gmail API
    let sendResult = null;
    try {
      sendResult = await sendEmail(email, {
        to,
        subject: subject || '',
        body,
        threadId: thread_id,
      });
      console.log(`[APPROVAL] Email successfully sent via Gmail API! Message ID: ${sendResult.id}`);
    } catch (sendErr) {
      console.error('[APPROVAL] Gmail API send error:', sendErr.message);
      if (sendErr.message?.includes('insufficient') || sendErr.code === 403) {
        return res.status(403).json({
          success: false,
          audit_id: auditId,
          error: 'Missing Gmail Send permission. Please click "Connect / Login with Google" in the header to grant send permission.',
          requiresAuth: true,
        });
      }
      throw sendErr;
    }

    return res.json({
      success: true,
      status: 'sent',
      audit_id: auditId,
      message_id: sendResult.id,
      message: `Email directly sent to ${to} via your Gmail account! (Audit #${auditId})`,
    });
  } catch (err) {
    console.error('[POST /draft/approve]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

router.post('/draft/approve', handleApprove);
router.post('/agent/draft/approve', handleApprove);
router.post('/approve-send', handleApprove);

// ─── GET /threads ─────────────────────────────────────────────────────────────
/**
 * Return recent email threads for the given user so they can easily pick one in the UI.
 */
router.get('/threads', (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'email query param required' });
  }
  try {
    const stmt = db.prepare(`
      SELECT thread_id, subject, sender, max(date_sent) as date_sent
      FROM emails
      WHERE user_email = ?
      GROUP BY thread_id
      ORDER BY date_sent DESC
      LIMIT 30
    `);
    const threads = stmt.all(email);
    return res.json({ success: true, threads });
  } catch (err) {
    console.error('[GET /threads]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

