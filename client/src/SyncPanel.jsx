import React, { useState } from 'react';
import { api } from './api';

export function SyncPanel({ email, onSyncComplete, onError }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  const handleSync = async () => {
    if (!email) {
      onError('Please enter your Gmail address in the account field above.');
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
    <div className="sync-strip">
      <div className="sync-strip-info">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
          <path d="M16 21h5v-5"/>
        </svg>
        <span>Vector Search Index</span>
        
        {stats && (
          <div className="sync-stats-group">
            <span className="sync-stat-item">Fetched: <strong>{stats.fetched ?? 0}</strong></span>
            <span className="sync-stat-item">Indexed: <strong>{stats.embedded ?? 0}</strong></span>
            {stats.skipped > 0 && (
              <span className="sync-stat-item">Unchanged: <strong>{stats.skipped}</strong></span>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={handleSync}
        disabled={loading}
      >
        {loading ? (
          <>
            <span className="spinner"></span>
            Syncing...
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            Sync Inbox
          </>
        )}
      </button>
    </div>
  );
}
