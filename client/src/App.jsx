import React, { useState, useEffect } from 'react';
import { api } from './api';
import { Navbar } from './Navbar';
import { SyncPanel } from './SyncPanel';
import { QueryView } from './QueryView';
import { DraftView } from './DraftView';

export default function App() {
  const [email, setEmail] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      localStorage.setItem('mailmind_session_token', tokenParam);
    }
    const emailParam = params.get('email');
    if (emailParam) {
      localStorage.setItem('mailmind_user_email', emailParam);
    }
    if (tokenParam || emailParam || params.get('authed')) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
    return emailParam || localStorage.getItem('mailmind_user_email') || localStorage.getItem('gemai_user_email') || '';
  });

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [serverStatus, setServerStatus] = useState(null);
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [globalError, setGlobalError] = useState(null);
  const [viewMode, setViewMode] = useState('split'); // 'split' | 'query' | 'draft'

  const handleEmailChange = (newEmail) => {
    setEmail(newEmail);
    localStorage.setItem('mailmind_user_email', newEmail);
  };

  useEffect(() => {
    api.checkHealth()
      .then((data) => setServerStatus(data))
      .catch((err) => {
        console.warn('Node server not detected yet:', err.message);
        setServerStatus(null);
      });
  }, []);

  useEffect(() => {
    if (!email) {
      setIsAuthorized(false);
      return;
    }
    api.checkAuthStatus(email)
      .then((data) => setIsAuthorized(Boolean(data.authorized)))
      .catch(() => setIsAuthorized(false));
  }, [email]);

  const handleThreadSelect = (threadId) => {
    setSelectedThreadId(threadId);
    if (viewMode === 'query') {
      setViewMode('draft');
    }
  };

  return (
    <div className="app-container">
      <Navbar
        email={email}
        onEmailChange={handleEmailChange}
        isAuthorized={isAuthorized}
        serverStatus={serverStatus}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {globalError && (
        <div className="toast-error">
          <span>{globalError}</span>
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
            onClick={() => setGlobalError(null)}
          >
            ✕
          </button>
        </div>
      )}

      <SyncPanel
        email={email}
        onError={(err) => setGlobalError(err)}
      />

      <main className={`workspace-grid ${viewMode === 'split' ? 'split' : 'single'}`}>
        {(viewMode === 'split' || viewMode === 'query') && (
          <QueryView
            email={email}
            onSelectThread={handleThreadSelect}
            onError={(err) => setGlobalError(err)}
          />
        )}

        {(viewMode === 'split' || viewMode === 'draft') && (
          <DraftView
            email={email}
            selectedThreadId={selectedThreadId}
            onError={(err) => setGlobalError(err)}
          />
        )}
      </main>
    </div>
  );
}
