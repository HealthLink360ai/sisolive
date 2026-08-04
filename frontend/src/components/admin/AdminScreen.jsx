import { Fragment, useState } from 'react';
import Icons from '../icons/Icons.jsx';
import NavAccount from '../shared/NavAccount.jsx';
import AdminDashboard from './AdminDashboard.jsx';
import AdminUsers from './AdminUsers.jsx';
import AdminUpload from './AdminUpload.jsx';
import AdminDocs from './AdminDocs.jsx';
import AdminEscalations from './AdminEscalations.jsx';
import AdminFeedback from './AdminFeedback.jsx';

/* ============================================================
   ADMIN SCREEN
   Ported from index.html (~lines 4335-4424).

   Local state: activeTab. Renders the admin sidebar nav and swaps
   between the 6 admin sub-views (dashboard, users, upload, docs,
   escalations, feedback). AdminUsers owns its own drill-down state
   for AdminUserDetail internally, so it's rendered here with no
   extra wiring.

   Fix applied per prior audit: the "Last 30 days ↓" range-pill in
   the admin-header-r was a decorative, non-functional element (no
   onClick, no backend date-range support) confirmed present in the
   shell itself (not any individual tab) — removed here rather than
   ported as fake-interactive UI.
   ============================================================ */
export default function AdminScreen({ user, onBack, onLogout, onRewatch }) {
  const [activeTab, setActiveTab] = useState('dashboard');

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'Overview' },
    { id: 'users', label: 'User activity', icon: 'users', section: '' },
    { id: 'upload', label: 'Add content', icon: 'upload', section: 'Knowledge base' },
    { id: 'docs', label: 'Manage docs', icon: 'files', section: '' },
    { id: 'escalations', label: 'Escalations', icon: 'alert', section: 'Insights' },
    { id: 'feedback', label: 'Feedback', icon: 'thumbup', section: '' },
  ];

  const tabLabel = {
    dashboard: 'Overview · Last 30 days', users: 'People · Last 30 days',
    upload: 'Knowledge base · Add content', docs: 'Knowledge base · Documents',
    escalations: 'Insights · Escalation log', feedback: 'Insights · User signal',
  };

  const tabH2 = {
    dashboard: <><em>Dashboard</em> overview</>, users: <>User <em>activity</em></>,
    upload: <>Add <em>content</em></>, docs: <>Manage <em>documents</em></>,
    escalations: <>Escalation <em>log</em></>, feedback: <>User <em>feedback</em></>,
  };

  return (
    <div className="app-shell is-admin">
      <div className="nav-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="nav-top-logo">
            <div className="nav-org"><img src="assets/abbvie-logo-white.png" alt="AbbVie" /></div>
            <div className="nav-sep"></div>
            <span className="nav-wordmark">SISO<span className="live">Live!</span></span>
          </div>
          <span className="nav-build">ADMIN CONSOLE</span>
        </div>
        <div className="nav-links">
          <div className="nav-link" onClick={onBack}>Learning tool</div>
          <div className="nav-link active">Admin dashboard</div>
        </div>
        <div className="nav-right">
          <div className="nav-status">
            <div className="nav-status-dot" />
            Live environment
          </div>
          <NavAccount user={user} onLogout={onLogout} onRewatch={onRewatch} />
        </div>
      </div>

      <div className="admin-screen">
        <div className="admin-sidebar">
          <div className="admin-context">
            <div className="label">Workspace</div>
            <div className="org">SISO Office <span className="badge">ADMIN</span></div>
          </div>

          {navItems.map((item) => (
            <Fragment key={item.id}>
              {item.section && <div className="admin-sec">{item.section}</div>}
              <div className={`admin-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
                role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setActiveTab(item.id)}>
                <span className="ai-ic">{Icons[item.icon]?.()}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
              </div>
            </Fragment>
          ))}

        </div>

        <div className="admin-main">
          <div className="admin-header">
            <div className="admin-header-l">
              <span className="eyebrow">{tabLabel[activeTab] || 'Overview'}</span>
              <h2>{tabH2[activeTab] || <><em>Dashboard</em></>}</h2>
            </div>
          </div>

          {activeTab === 'dashboard' && <AdminDashboard />}
          {activeTab === 'users' && <AdminUsers />}
          {activeTab === 'upload' && <AdminUpload />}
          {activeTab === 'docs' && <AdminDocs />}
          {activeTab === 'escalations' && <AdminEscalations />}
          {activeTab === 'feedback' && <AdminFeedback />}
        </div>
      </div>
    </div>
  );
}
