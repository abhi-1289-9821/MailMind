import React, { useState } from 'react';
import { api } from './api';

export function SyncPanel({ email, onSyncComplete, onError }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  const handleSync = async () => {
    if (!email) {
      onError('Please enter your Gmail address in the header first.');
      return;
    }

    setLoading(true);
    onError(null);

    try {
      const result = await api.triggerIngest(email);
      setStats(result);
      if (onSyncComplete) onSyncComplete(result);
    } catch (err) {
      onError(err.message || 'Email sync failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sync-banner">
      <div className="sync-info">
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#fff', margin: 0 }}>
            Gmail Ingestion & RAG Index
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            Pulls messages via Gmail API, generates thread-aware embeddings, and syncs Chroma vector database.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {stats && (
          <div className="sync-stats">
            <div className="stat-chip">
              <span>Fetched:</span>
              <strong>{stats.fetched ?? 0}</strong>
            </div>
            <div className="stat-chip">
              <span>Inserted:</span>
              <strong>{stats.inserted ?? 0}</strong>
            </div>
            <div className="stat-chip">
              <span>Indexed:</span>
              <strong>{stats.embedded ?? 0}</strong>
            </div>
            <div className="stat-chip">
              <span>Skipped:</span>
              <strong>{stats.skipped ?? 0}</strong>
            </div>
          </div>
        )}

        <button
          className="btn btn-secondary"
          onClick={handleSync}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner"></span>
              Syncing & Embedding...
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              Sync & Index Emails
            </>
          )}
        </button>
      </div>
    </div>
  );
}
