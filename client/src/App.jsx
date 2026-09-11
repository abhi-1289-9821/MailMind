import React, { useState, useEffect } from 'react';
import { api } from './api';
import { Navbar } from './Navbar';
import { SyncPanel } from './SyncPanel';
import { QueryView } from './QueryView';
import { DraftView } from './DraftView';

export default function App() {
  const [email, setEmail] = useState(() => {
    // Check URL params first (e.g. after OAuth redirect), then localStorage
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      localStorage.setItem('mailmind_session_token', tokenParam);
    }
    const emailParam = params.get('email');
    if (emailParam) {
      localStorage.setItem('mailmind_user_email', emailParam);
    }
    // Clean up URL if auth params were present
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

  // Store email preference
  const handleEmailChange = (newEmail) => {
    setEmail(newEmail);
    localStorage.setItem('mailmind_user_email', newEmail);
  };

  // Poll server health on mount
  useEffect(() => {
    api.checkHealth()
      .then((data) => setServerStatus(data))
      .catch((err) => {
        console.warn('Node server not detected yet:', err.message);
        setServerStatus(null);
      });
  }, []);

  // Check auth status whenever email changes
  useEffect(() => {
    if (!email) {
      setIsAuthorized(false);
      return;
    }
    api.checkAuthStatus(email)
      .then((data) => setIsAuthorized(Boolean(data.authorized)))
      .catch(() => setIsAuthorized(false));
  }, [email]);

  return (
    <div className="app-container">
      <Navbar
        email={email}
        onEmailChange={handleEmailChange}
        isAuthorized={isAuthorized}
        serverStatus={serverStatus}
      />

      {globalError && (
        <div className="error-banner">
          <span>{globalError}</span>
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 'bold' }}
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

      <main className="main-grid">
        <QueryView
          email={email}
          onSelectThread={(tid) => setSelectedThreadId(tid)}
          onError={(err) => setGlobalError(err)}
        />

        <DraftView
          email={email}
          selectedThreadId={selectedThreadId}
          onError={(err) => setGlobalError(err)}
        />
      </main>
    </div>
  );
}
