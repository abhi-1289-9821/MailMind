import React from 'react';

export function Navbar({ 
  email, 
  onEmailChange, 
  isAuthorized, 
  serverStatus,
  viewMode,
  onViewModeChange
}) {
  const handleConnectGmail = () => {
    window.location.href = 'http://localhost:4000/auth/login';
  };

  return (
    <header className="header">
      <div className="brand">
        <div className="brand-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="16" x="2" y="4" rx="2"/>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          </svg>
        </div>
        <div className="brand-title">
          MailMind
          <span className="brand-tag">Copilot</span>
        </div>
      </div>

      {/* Center Segmented View Switcher */}
      {onViewModeChange && (
        <div className="view-switcher">
          <button
            type="button"
            className={`view-tab ${viewMode === 'split' ? 'active' : ''}`}
            onClick={() => onViewModeChange('split')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
            Workspace
          </button>
          <button
            type="button"
            className={`view-tab ${viewMode === 'query' ? 'active' : ''}`}
            onClick={() => onViewModeChange('query')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Search & Q&A
          </button>
          <button
            type="button"
            className={`view-tab ${viewMode === 'draft' ? 'active' : ''}`}
            onClick={() => onViewModeChange('draft')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            Reply Studio
          </button>
        </div>
      )}

      {/* Right Actions & Account */}
      <div className="header-actions">
        {serverStatus ? (
          <span className="status-pill status-live" title="Backend connected">
            <span className="status-dot"></span>
            Live
          </span>
        ) : (
          <span className="status-pill status-pending" title="Checking server...">
            <span className="status-dot"></span>
            Connecting
          </span>
        )}

        <div className="account-strip">
          <input
            type="email"
            className="account-input"
            placeholder="name@gmail.com"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
          />

          {isAuthorized ? (
            <span className="status-pill status-live" style={{ padding: '3px 8px', fontSize: '11px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Linked
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleConnectGmail}
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
