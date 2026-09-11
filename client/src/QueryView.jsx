import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from './api';

const SAMPLE_QUESTIONS = [
  "What were the project deadlines discussed?",
  "What did Sarah say about the budget?",
  "What is the status of the launch proposal?",
];

export function QueryView({ email, onSelectThread, onError }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [expandedIndex, setExpandedIndex] = useState(null);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!question.trim()) return;

    if (!email) {
      onError('Please enter your Gmail address in the top header.');
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
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            Ask Questions (RAG Agent)
          </h2>
          <p className="card-subtitle">Natural-language query over indexed email threads with source verification</p>
        </div>
      </div>

      <div className="suggestion-chips">
        {SAMPLE_QUESTIONS.map((q, i) => (
          <button
            key={i}
            type="button"
            className="chip"
            onClick={() => handleChipClick(q)}
          >
            {q}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <input
            type="text"
            className="input"
            placeholder="Ask about meetings, deliverables, decisions, receipts..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={loading || !question.trim()}
        >
          {loading ? (
            <>
              <span className="spinner"></span>
              Searching Emails & Generating Answer...
            </>
          ) : (
            'Ask Copilot'
          )}
        </button>
      </form>

      {result && (
        <div className="answer-container">
          <div className="sources-header">
            <span>Agent Answer</span>
            <span className="badge badge-connected" style={{ fontSize: '11px' }}>Grounded</span>
          </div>

          <div className="answer-box markdown-content">
            <ReactMarkdown>{result.answer}</ReactMarkdown>
          </div>

          {result.sources && result.sources.length > 0 && (
            <div>
              <div className="sources-header">
                <span>Sources Cited ({result.sources.length})</span>
              </div>

              {result.sources.map((src, idx) => (
                <div key={idx} className="source-card">
                  <div className="source-summary" onClick={() => toggleSource(idx)}>
                    <div>
                      <div className="source-subject">{src.subject || '(No Subject)'}</div>
                      <div className="source-meta">
                        <span>From: {src.sender}</span>
                        <span>•</span>
                        <span>{src.date}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectThread && src.thread_id) {
                            onSelectThread(src.thread_id);
                          }
                        }}
                      >
                        Draft Reply
                      </button>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {expandedIndex === idx ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>

                  {expandedIndex === idx && (
                    <div className="source-details">
                      <p><strong>Thread ID:</strong> <code>{src.thread_id}</code></p>
                      <p style={{ marginTop: '4px' }}>
                        This email was retrieved from your Chroma vector store using BGE embeddings.
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
