/**
 * api.js — Centralized HTTP client communicating strictly with the Node.js backend.
 * Base URL defaults to http://localhost:4000.
 */

const BASE_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

function getStoredToken() {
  try {
    return localStorage.getItem('mailmind_session_token');
  } catch {
    return null;
  }
}

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const token = getStoredToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data.detail || data.error || `HTTP ${response.status}: ${response.statusText}`;
      const err = new Error(errorMsg);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data;
  } catch (err) {
    if (err.status) throw err;
    throw new Error(`Failed to connect to server at ${BASE_URL}. Is Node server running? (${err.message})`);
  }
}

export const api = {
  // Check Node server health
  checkHealth() {
    return request('/health');
  },

  // Check OAuth authorization status for a user email
  checkAuthStatus(email) {
    if (!email) return Promise.resolve({ authorized: false });
    return request(`/auth/status?email=${encodeURIComponent(email)}`);
  },

  // Trigger Gmail fetch and indexing
  triggerIngest(email, limit = 50) {
    return request('/ingest', {
      method: 'POST',
      body: JSON.stringify({ email, limit }),
    });
  },

  // Ask natural language question to RAG / LangGraph agent
  askQuestion(email, question) {
    return request('/query', {
      method: 'POST',
      body: JSON.stringify({ email, question }),
    });
  },

  // Generate an email draft reply
  generateDraft(email, threadId, instruction) {
    return request('/draft', {
      method: 'POST',
      body: JSON.stringify({ email, thread_id: threadId, instruction }),
    });
  },

  // Human approval for draft sending (records audit in SQLite)
  approveDraft({ email, threadId, to, subject, body }) {
    return request('/draft/approve', {
      method: 'POST',
      body: JSON.stringify({
        email,
        thread_id: threadId,
        to,
        subject,
        body,
      }),
    });
  },

  // Fetch recent threads for quick dropdown selection
  getThreads(email) {
    if (!email) return Promise.resolve({ threads: [] });
    return request(`/threads?email=${encodeURIComponent(email)}`);
  },
};
