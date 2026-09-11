'use strict';

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// Ensure the data directory exists (git-ignored)
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'gemai.db');

let _sqlJsDb = null; // set by initDb()
let _inTx    = false; // true while inside a transaction
const _allStatements = new Set();

function invalidateStatements() {
  for (const s of _allStatements) {
    s._stmt = null;
  }
}

// ─── File persistence ─────────────────────────────────────────────────────────

function save() {
  if (_inTx) return; // defer writes until COMMIT
  invalidateStatements();
  const data = _sqlJsDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─── Parameter normalisation ──────────────────────────────────────────────────
// better-sqlite3 accepts: @name / :name / $name / positional [?] / primitives
// sql.js accepts:         $name                / positional [?]
// This function converts to sql.js format.

function normalizeParams(params) {
  if (params === null || params === undefined) return undefined;

  // Single primitive → wrap in positional array
  if (typeof params === 'string' || typeof params === 'number' || typeof params === 'bigint') {
    return [params];
  }

  if (Array.isArray(params)) return params;

  // Named param object: { email: 'x' }  or  { '@email': 'x' }
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    const name = k.replace(/^[@:$]/, '');
    out[`$${name}`] = v ?? null;
  }
  return out;
}

// ─── Statement wrapper ────────────────────────────────────────────────────────

class Statement {
  constructor(rawSql) {
    // Convert @name → $name (sql.js understands $name and :name)
    this._sql  = rawSql.replace(/@(\w+)/g, '$$$1');
    this._stmt = null; // lazily initialised on first use
    _allStatements.add(this);
  }

  _getStmt() {
    if (!this._stmt) {
      if (!_sqlJsDb) throw new Error('DB not initialised — await initDb() before using the DB');
      this._stmt = _sqlJsDb.prepare(this._sql);
    }
    return this._stmt;
  }

  /** Execute without returning rows (INSERT / UPDATE / DELETE). */
  run(params) {
    const stmt = this._getStmt();
    const p = normalizeParams(params);
    p !== undefined ? stmt.run(p) : stmt.run();
    save();
    return this;
  }

  /** Return the first matching row as a plain object, or undefined if none. */
  get(params) {
    const stmt = this._getStmt();
    stmt.reset();
    const p = normalizeParams(params);
    if (p !== undefined) stmt.bind(p);
    const found = stmt.step();
    const row   = found ? stmt.getAsObject() : undefined;
    stmt.reset();
    return row;
  }

  /** Return all matching rows as an array of plain objects. */
  all(params) {
    const stmt = this._getStmt();
    stmt.reset();
    const p = normalizeParams(params);
    if (p !== undefined) stmt.bind(p);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.reset();
    return rows;
  }
}

// ─── DB wrapper (better-sqlite3-compatible surface) ───────────────────────────

const db = {
  /** Execute one or more DDL/DML statements with no params (schema, PRAGMA, etc.). */
  exec(sql) {
    _sqlJsDb.exec(sql); // sql.js exec handles multi-statement strings
    save();
    return db;
  },

  /** Create a reusable prepared statement. Underlying stmt is created lazily. */
  prepare(sql) {
    return new Statement(sql);
  },

  /**
   * Wrap a function in a BEGIN / COMMIT transaction.
   * Returns a *new function*; call the returned function to execute the transaction.
   */
  transaction(fn) {
    return (...args) => {
      _sqlJsDb.run('BEGIN');
      _inTx = true;
      try {
        const result = fn(...args);
        _sqlJsDb.run('COMMIT');
        _inTx = false;
        save(); // write once after commit
        return result;
      } catch (err) {
        _sqlJsDb.run('ROLLBACK');
        _inTx = false;
        throw err;
      }
    };
  },
};

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    id            INTEGER PRIMARY KEY,
    user_email    TEXT UNIQUE NOT NULL,
    refresh_token TEXT NOT NULL,
    access_token  TEXT,
    token_expiry  INTEGER,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS emails (
    id             TEXT PRIMARY KEY,
    thread_id      TEXT NOT NULL,
    user_email     TEXT NOT NULL,
    subject        TEXT,
    sender         TEXT,
    recipient      TEXT,
    date_sent      INTEGER,
    body           TEXT,
    has_attachment INTEGER NOT NULL DEFAULT 0,
    indexed        INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id     TEXT NOT NULL,
    recipient     TEXT NOT NULL,
    subject       TEXT,
    approved_by   TEXT NOT NULL,
    approved_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    body_snapshot TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_emails_thread   ON emails(thread_id);
  CREATE INDEX IF NOT EXISTS idx_emails_indexed  ON emails(indexed);
  CREATE INDEX IF NOT EXISTS idx_emails_user     ON emails(user_email);
  CREATE INDEX IF NOT EXISTS idx_emails_date     ON emails(date_sent);
  CREATE INDEX IF NOT EXISTS idx_approvals_thread ON approvals(thread_id);
  CREATE INDEX IF NOT EXISTS idx_approvals_user   ON approvals(approved_by);
`;

// ─── Approvals Audit Helper ───────────────────────────────────────────────────

function recordApproval({ threadId, recipient, subject, approvedBy, bodySnapshot }) {
  const stmt = db.prepare(`
    INSERT INTO approvals (thread_id, recipient, subject, approved_by, approved_at, body_snapshot)
    VALUES (@threadId, @recipient, @subject, @approvedBy, strftime('%s','now'), @bodySnapshot)
  `);
  stmt.run({
    threadId,
    recipient,
    subject: subject || '',
    approvedBy,
    bodySnapshot: bodySnapshot || '',
  });
  const row = db.prepare('SELECT max(id) as id FROM approvals').get();
  return row ? row.id : null;
}



// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Load the WASM SQLite engine, open (or create) the database file,
 * and run schema migrations.  Must be awaited once at server startup.
 *
 * @returns {typeof db} the synchronous DB wrapper
 */
async function initDb() {
  const SQL = await initSqlJs(); // loads the WASM binary

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _sqlJsDb = new SQL.Database(buf);
    console.log(`[db] Loaded existing database (${Math.round(buf.length / 1024)} KB) from ${DB_PATH}`);
  } else {
    _sqlJsDb = new SQL.Database();
    console.log(`[db] Created new database at ${DB_PATH}`);
  }

  _sqlJsDb.exec(SCHEMA); // idempotent — CREATE IF NOT EXISTS
  save();                // persist schema to disk immediately

  return db;
}

module.exports = { db, initDb, recordApproval };

