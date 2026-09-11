import React, { useState, useEffect } from 'react';
import { api } from './api';

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
      onError('Please enter your Gmail address in the header.');
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

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Draft Reply (Human-in-the-Loop)
          </h2>
          <p className="card-subtitle">Generate context-aware reply drafts with mandatory manual approval</p>
        </div>
      </div>

      <form onSubmit={handleGenerateDraft}>
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label className="form-label" style={{ margin: 0 }}>Gmail Thread</label>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Select or enter 16-char ID</span>
          </div>

          {threads.length > 0 && (
            <select
              className="input"
              style={{ marginBottom: '8px', cursor: 'pointer', background: 'var(--surface-light, #252b3b)' }}
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
            >
              <option value="">-- Choose from your synced emails --</option>
              {threads.map((t) => (
                <option key={t.thread_id} value={t.thread_id}>
                  {(t.subject || 'No Subject').substring(0, 42)} — {t.sender?.split('<')[0]?.trim() || t.sender}
                </option>
              ))}
            </select>
          )}

          <input
            type="text"
            className="input"
            placeholder="e.g. 1a0720b00e136efa (or pick from dropdown above)"
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Your Instruction / Intent</label>
          <textarea
            className="textarea"
            style={{ minHeight: '75px' }}
            placeholder="e.g., 'Confirm that Tuesday at 2pm works, and mention we already reviewed the slide deck.'"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={loading || !threadId.trim() || !instruction.trim()}
        >
          {loading ? (
            <>
              <span className="spinner"></span>
              Drafting Reply with Thread Context...
            </>
          ) : (
            'Generate Draft Reply'
          )}
        </button>
      </form>

      {draft && (
        <div className="draft-preview">
          <div className="draft-header-row">
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>
              Draft Preview
            </span>
            {approvalResult ? (
              <span className="badge badge-connected">
                <span className="badge-dot"></span>
                Approved & Audited
              </span>
            ) : (
              <span className="badge badge-pending">
                <span className="badge-dot"></span>
                Pending Approval
              </span>
            )}
          </div>

          <div className="draft-field">
            <strong>To:</strong> <span>{draft.to}</span>
          </div>

          <div className="draft-field">
            <strong>Subject:</strong> <span>{draft.subject}</span>
          </div>

          <div className="form-group" style={{ marginTop: '12px' }}>
            <label className="form-label">Email Body (Editable)</label>
            <textarea
              className="textarea"
              style={{ minHeight: '140px', fontSize: '13px' }}
              value={editableBody}
              onChange={(e) => setEditableBody(e.target.value)}
              disabled={Boolean(approvalResult)}
            />
          </div>

          <div className="safe-notice">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span>
              <strong>Safety Guard:</strong> System will NEVER send without your explicit approval. Send scope is omitted by design.
            </span>
          </div>

          {!approvalResult ? (
            <button
              type="button"
              className="btn btn-success"
              style={{ width: '100%' }}
              onClick={handleApprove}
              disabled={approving || !editableBody.trim()}
            >
              {approving ? (
                <>
                  <span className="spinner"></span>
                  Recording Approval...
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  Approve & Record Send
                </>
              )}
            </button>
          ) : (
            <div className="success-banner">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <div>
                <strong>Approval Recorded (Audit #{approvalResult.audit_id})</strong>
                <div style={{ fontSize: '12px', marginTop: '2px' }}>
                  {approvalResult.message}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
