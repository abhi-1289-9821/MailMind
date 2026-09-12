import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from './api';

const SAMPLE_QUESTIONS = [
  "What deadlines or milestones were discussed?",
  "Did I receive any security or account alerts?",
  "Status of job applications or rejection notices?",
  "What updates did Railway or dev tools send?",
];

function getInitials(sender = '') {
  const clean = sender.replace(/<.*?>/, '').trim();
  const parts = clean.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length > 0) return parts[0].slice(0, 2).toUpperCase();
  return 'EM';
}

function getSenderName(sender = '') {
  return sender.split('<')[0].replace(/"/g, '').trim() || sender;
}

export function QueryView({ email, onSelectThread, onError }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [expandedIndex, setExpandedIndex] = useState(null);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!question.trim()) return;

    if (!email) {
      onError('Please enter your Gmail address in the account field.');
      return;
    }

    setLoading(true);
    onError(null);

    try {
      const res = await api.askQuestion(email, question);
      setResult(res);
      setExpandedIndex(null);
    } catch (err) {
      onError(err.message || 'Error processing email query.');
    } finally {
      setLoading(false);
    }
  };

  const handleChipClick = (q) => {
    setQuestion(q);
  };

  const toggleSource = (idx) => {
    setExpandedIndex(expandedIndex === idx ? null : idx);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-primary)' }}>
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Inbox Intelligence
          </div>
          <div className="panel-caption">Semantic search and grounded question answering</div>
        </div>
      </div>

      <div className="panel-body">
        {/* Command Search Bar */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="command-box">
            <div className="command-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <input
              type="text"
              className="command-input"
              placeholder="Ask about meetings, decisions, invoices, updates..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            {loading ? (
              <span className="spinner"></span>
            ) : (
              <span className="kbd-badge">↵ Enter</span>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={loading || !question.trim()}
            >
              Search
            </button>
          </div>

          {/* Preset Prompts */}
          <div className="query-prompts">
            {SAMPLE_QUESTIONS.map((q, i) => (
              <button
                key={i}
                type="button"
                className="query-prompt-chip"
                onClick={() => handleChipClick(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </form>

        {/* Synthesized Response */}
        {result && (
          <div className="answer-panel">
            <div className="answer-header">
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Synthesized Summary
              </span>
              <span className="answer-badge">
                Verified Grounded
              </span>
            </div>

            <div className="markdown-answer">
              <ReactMarkdown>{result.answer}</ReactMarkdown>
            </div>

            {/* Cited Email Cards */}
            {result.sources && result.sources.length > 0 && (
              <div className="citations-list" style={{ marginTop: '12px' }}>
                <div className="citation-header">
                  <span>Referenced Emails ({result.sources.length})</span>
                </div>

                {result.sources.map((src, idx) => (
                  <div key={idx} className="email-source-card">
                    <div className="email-source-main" onClick={() => toggleSource(idx)}>
                      <div className="email-source-meta">
                        <div className="sender-avatar">
                          {getInitials(src.sender)}
                        </div>
                        <div className="email-details-inline">
                          <div className="email-subject-line">
                            {src.subject || '(No Subject)'}
                          </div>
                          <div className="email-sender-subtext">
                            <span>{getSenderName(src.sender)}</span>
                            <span>•</span>
                            <span>{src.date || 'Recent'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="email-source-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectThread && src.thread_id) {
                              onSelectThread(src.thread_id);
                            }
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="9 17 4 12 9 7"/>
                            <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                          </svg>
                          Draft Reply
                        </button>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {expandedIndex === idx ? '▲' : '▼'}
                        </span>
                      </div>
                    </div>

                    {expandedIndex === idx && (
                      <div className="email-expanded-body">
                        <div style={{ marginBottom: '4px' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Thread ID:</span>{' '}
                          <code style={{ fontFamily: 'var(--font-mono)' }}>{src.thread_id}</code>
                        </div>
                        {src.body && (
                          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '6px' }}>
                            {src.body.slice(0, 320)}...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
