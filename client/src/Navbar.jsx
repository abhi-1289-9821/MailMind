import React from 'react';

export function Navbar({ email, onEmailChange, isAuthorized, serverStatus }) {
  const handleConnectGmail = () => {
    // Direct browser to Node server OAuth login route
    window.location.href = 'http://localhost:4000/auth/login';
  };

  return (
    <header className="header">
      <div className="brand">
        <div className="brand-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>
        <div>
          <h1 className="brand-title" style={{ margin: 0, fontSize: '20px' }}>MailMind</h1>
          <p className="brand-subtitle">RAG-Powered AI Email Assistant</p>
        </div>
      </div>

      <div className="header-actions">
        {serverStatus ? (
          <span className="badge badge-connected" title={`Node Server v1.0.0 (Phase ${serverStatus.phase})`}>
            <span className="badge-dot"></span>
            Server Live (P{serverStatus.phase})
          </span>
        ) : (
          <span className="badge badge-pending">
            <span className="badge-dot"></span>
            Connecting...
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="email"
            className="input"
            style={{ width: '220px', padding: '6px 10px', fontSize: '13px' }}
            placeholder="your.email@gmail.com"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
          />

          {isAuthorized ? (
            <span className="badge badge-connected">
              <span className="badge-dot"></span>
              Gmail Linked
            </span>
          ) : (
            <button
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: '13px' }}
              onClick={handleConnectGmail}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14h2v2h-2zm0-10h2v8h-2z"/>
              </svg>
              Connect Gmail
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
