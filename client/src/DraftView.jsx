import React, { useState, useEffect } from 'react';
import { api } from './api';

const INTENT_PRESETS = [
  "Polite decline & suggest later",
  "Confirm availability & thank them",
  "Request more technical details",
  "Follow up on status update",
];

export function DraftView({ email, selectedThreadId, onError }) {
  const [threadId, setThreadId] = useState(selectedThreadId || '');
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [draft, setDraft] = useState(null);
  const [editableBody, setEditableBody] = useState('');
  const [approvalResult, setApprovalResult] = useState(null);
  const [threads, setThreads] = useState([]);

  useEffect(() => {
    if (email) {
      api.getThreads(email)
        .then((res) => {
          if (res.threads) setThreads(res.threads);
        })
        .catch(() => {});
    }
  }, [email]);

  useEffect(() => {
    if (selectedThreadId) {
      setThreadId(selectedThreadId);
    }
  }, [selectedThreadId]);

  const handleGenerateDraft = async (e) => {
    if (e) e.preventDefault();
    if (!threadId.trim() || !instruction.trim()) return;

    if (!email) {
      onError('Please enter your Gmail address in the account field.');
      return;
    }

    setLoading(true);
    onError(null);
    setApprovalResult(null);

    try {
      const res = await api.generateDraft(email, threadId.trim(), instruction.trim());
      setDraft(res);
      setEditableBody(res.body || '');
    } catch (err) {
      onError(err.message || 'Failed to generate draft.');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!draft || !email) return;

    setApproving(true);
    onError(null);

    try {
      const res = await api.approveDraft({
        email,
        threadId: draft.thread_id,
        to: draft.to,
        subject: draft.subject,
        body: editableBody,
      });
      setApprovalResult(res);
    } catch (err) {
      onError(err.message || 'Failed to approve draft send.');
    } finally {
      setApproving(false);
    }
  };

  const applyPreset = (presetText) => {
    setInstruction(presetText);
  };

  const selectedThreadMeta = threads.find((t) => t.thread_id === threadId);

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-primary)' }}>
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            Reply Studio
          </div>
          <div className="panel-caption">Context-aware thread replies with human review</div>
        </div>
      </div>

      <div className="panel-body">
        <form onSubmit={handleGenerateDraft} className="composer-box">
          {/* Thread Selection */}
          <div className="field-group">
            <label className="field-label">
              <span>Target Conversation</span>
              {selectedThreadMeta && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  ID: {threadId.slice(0, 8)}...
                </span>
              )}
            </label>

            {threads.length > 0 && (
              <select
                className="composer-select"
                value={threadId}
                onChange={(e) => setThreadId(e.target.value)}
              >
                <option value="">Choose an active conversation...</option>
                {threads.map((t) => {
                  const cleanSender = t.sender?.split('<')[0]?.trim() || t.sender;
                  const cleanSubject = t.subject || 'No Subject';
                  return (
                    <option key={t.thread_id} value={t.thread_id}>
                      {cleanSubject.length > 45 ? cleanSubject.slice(0, 45) + '…' : cleanSubject} — {cleanSender}
                    </option>
                  );
                })}
              </select>
            )}

            <input
              type="text"
              className="composer-input"
              placeholder="Or paste 16-character Thread ID"
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
            />
          </div>

          {/* User Intent & Presets */}
          <div className="field-group">
            <label className="field-label">
              <span>Your Instructions</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>What would you like to say?</span>
            </label>
            <textarea
              className="composer-textarea"
              placeholder="e.g., Confirm Thursday works, mention that I reviewed their presentation and ask for the zoom link."
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />

            <div className="intent-presets">
              {INTENT_PRESETS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className="intent-preset-btn"
                  onClick={() => applyPreset(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '4px' }}
            disabled={loading || !threadId.trim() || !instruction.trim()}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Synthesizing Draft...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                Generate Reply Draft
              </>
            )}
          </button>
        </form>

        {/* Draft Inspection & Approval */}
        {draft && (
          <div className="draft-review-sheet">
            <div className="draft-review-meta">
              <div className="draft-meta-row">
                <span className="label">To:</span>
                <span className="val">{draft.to}</span>
              </div>
              <div className="draft-meta-row">
                <span className="label">Subject:</span>
                <span className="val">{draft.subject}</span>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">
                <span>Message Body</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Editable before sending</span>
              </label>
              <textarea
                className="composer-textarea"
                style={{ minHeight: '140px', fontSize: '13px' }}
                value={editableBody}
                onChange={(e) => setEditableBody(e.target.value)}
                disabled={Boolean(approvalResult)}
              />
            </div>

            <div className="review-assurance-tag">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span>Human-in-the-loop guarantee: This email will only be sent when you click Approve.</span>
            </div>

            {!approvalResult ? (
              <button
                type="button"
                className="btn btn-send"
                style={{ width: '100%', marginTop: '4px' }}
                onClick={handleApprove}
                disabled={approving || !editableBody.trim()}
              >
                {approving ? (
                  <>
                    <span className="spinner"></span>
                    Dispatching via Gmail...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                    Approve & Send Email
                  </>
                )}
              </button>
            ) : (
              <div className="toast-success">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: '2px' }}>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <div>
                  <div style={{ fontWeight: 600 }}>Dispatched directly through your Gmail</div>
                  <div style={{ fontSize: '12px', marginTop: '2px', color: 'rgba(255, 255, 255, 0.8)' }}>
                    {approvalResult.message}
                  </div>
                  {approvalResult.message_id && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Message ID: <code>{approvalResult.message_id}</code>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
