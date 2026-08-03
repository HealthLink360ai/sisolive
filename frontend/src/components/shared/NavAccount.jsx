import { useState } from 'react';
import Icons from '../icons/Icons.jsx';

/* ============================================================
   NAV ACCOUNT
   Ported verbatim from index.html (~lines 3102-3184).
   Shared dropdown nav menu used by both ChatScreen and AdminScreen.

   Props:
     user     — { name, email, initials?, role?, department? } | null
     onLogout — () => void, called after the sign-out confirm dialog
                is confirmed
     onRewatch — optional () => void, triggers "Rewatch orientation"

   NOTE (per prior audit): the "Account settings" dialog is an
   intentional, honest stub — it tells the user account management
   isn't available yet (pending AbbVie SSO), it is not a fake/dummy
   feature. Do not add editing capability to the Profile dialog either
   (it is read-only by design) and do not implement fake settings.
   ============================================================ */
export default function NavAccount({ user, onLogout, onRewatch }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const initials = user ? (user.initials || (user.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?') : '?';
  return (
    <div className="nav-account">
      <div className="nav-user" onClick={() => setOpen((o) => !o)}>
        <div className="nav-user-av">{initials}</div>
        {user ? (user.name || user.email || 'User') : 'User'}
        <span className="nav-user-caret">▾</span>
      </div>
      {open && (
        <>
          <div className="nav-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="nav-menu">
            <div className="nav-menu-head">
              <div className="nav-menu-av">{initials}</div>
              <div>
                <div className="nav-menu-name">{user ? (user.name || 'User') : 'User'}</div>
                <div className="nav-menu-mail">{user ? (user.email || '') : ''}</div>
              </div>
            </div>
            <div className="nav-menu-item" onClick={() => { setOpen(false); setShowProfile(true); }}>
              <span className="nm-ic"><Icons.user /></span>Profile
            </div>
            <div className="nav-menu-item" onClick={() => { setOpen(false); setShowSettings(true); }}>
              <span className="nm-ic"><Icons.settings /></span>Account settings
            </div>
            <div className="nav-menu-item" onClick={() => { setOpen(false); onRewatch && onRewatch(); }}>
              <span className="nm-ic"><Icons.play /></span>Rewatch orientation
            </div>
            <div className="nav-menu-sep" />
            <div className="nav-menu-item danger" onClick={() => { setOpen(false); setConfirm(true); }}>
              <span className="nm-ic"><Icons.logout /></span>Sign out
            </div>
          </div>
        </>
      )}
      {confirm && (
        <div className="logout-overlay" onClick={() => setConfirm(false)}>
          <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ld-ic"><Icons.logout /></div>
            <h3>Sign out of SISO Live!?</h3>
            <p>You'll be returned to the sign-in screen. Your conversation history stays saved to your AbbVie account.</p>
            <div className="logout-actions">
              <button className="logout-btn ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="logout-btn solid" onClick={() => { setConfirm(false); onLogout && onLogout(); }}>
                <span style={{ width: 14, height: 14 }}><Icons.logout /></span>Sign out
              </button>
            </div>
          </div>
        </div>
      )}
      {showProfile && (
        <div className="logout-overlay" onClick={() => setShowProfile(false)}>
          <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ld-ic" style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)' }}>{initials}</div>
            <h3>{user?.name || 'User'}</h3>
            <p style={{ marginBottom: 4 }}>{user?.email || '—'}</p>
            {user?.role && <p style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'capitalize', marginBottom: 0 }}>{user.role}{user.department ? ` · ${user.department}` : ''}</p>}
            <div className="logout-actions" style={{ marginTop: 24 }}>
              <button className="logout-btn ghost" onClick={() => setShowProfile(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <div className="logout-overlay" onClick={() => setShowSettings(false)}>
          <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ld-ic"><Icons.settings /></div>
            <h3>Account settings</h3>
            <p>Full account management will be available when AbbVie SSO is enabled in the production release.</p>
            <div className="logout-actions" style={{ marginTop: 24 }}>
              <button className="logout-btn ghost" onClick={() => setShowSettings(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
