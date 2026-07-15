import { useEffect, useState } from 'react';
import LoginScreen from './components/login/LoginScreen.jsx';
import OnboardScreen from './components/onboarding/OnboardScreen.jsx';
import ChatScreen from './components/chat/ChatScreen.jsx';
import AdminScreen from './components/admin/AdminScreen.jsx';
import { AuthAPI } from './api/auth.js';
import { TOKEN_KEY, USER_KEY, getToken, clearStoredSession, setOnUnauthorized } from './api/client.js';

/* ============================================================
   APP
   Ported from index.html (~lines 4429-4532).

   Owns the top-level routing state machine (screen: 'login' |
   'onboard' | 'chat' | 'admin'), the current `user`, and the
   `signedOut` flag surfaced by LoginScreen. Uses plain conditional
   rendering — no react-router. Bootstraps the session from
   localStorage on mount via AuthAPI.validate(), and wires the
   global 401 handler (setOnUnauthorized) so any API call that gets
   Unauthorized anywhere in the app forces a logout back to
   LoginScreen with signedOut set.
   ============================================================ */
export default function App() {
  const forceFreshOnboarding = () => sessionStorage.getItem('siso_force_onboard_once') === '1';
  const onboardKeyFor = (u) => `siso_onboard_done:${String(u?.email || u?.id || 'guest').toLowerCase()}`;
  const shouldShowOnboarding = (u) => {
    if (!u) return false;
    if (forceFreshOnboarding()) return true;
    if (u.firstLogin === true) return true;
    return localStorage.getItem(onboardKeyFor(u)) !== '1';
  };

  const [screen, setScreen] = useState(() => {
    try {
      const freshDemo = new URLSearchParams(window.location.search).get('fresh') === '1';
      if (freshDemo) {
        Object.keys(localStorage)
          .filter(k => k === 'siso_onboard_done' || k.startsWith('siso_onboard_done:'))
          .forEach(k => localStorage.removeItem(k));
        sessionStorage.setItem('siso_force_onboard_once', '1');
        window.history.replaceState({}, '', window.location.pathname);
      }
      const u = localStorage.getItem(USER_KEY);
      const tok = getToken();
      if (!u || !tok) {
        clearStoredSession();
        return 'login';
      }
      const parsed = JSON.parse(u);
      if (forceFreshOnboarding()) return 'onboard';
      return shouldShowOnboarding(parsed) ? 'onboard' : 'chat';
    } catch { return 'login'; }
  });
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u && getToken() ? JSON.parse(u) : null;
    } catch { return null; }
  });
  const [signedOut, setSignedOut] = useState(false);

  // Register the global 401 handler and validate stored session on load
  useEffect(() => {
    setOnUnauthorized(() => {
      clearStoredSession();
      setUser(null);
      setScreen('login');
      setSignedOut(true);
    });
    // Validate stored token — if expired or invalid, clear session now
    if (getToken()) {
      AuthAPI.validate().catch(() => {
        clearStoredSession();
        setUser(null);
        setScreen('login');
      });
    } else if (localStorage.getItem(USER_KEY)) {
      clearStoredSession();
      setUser(null);
      setScreen('login');
    }
  }, []);

  const handleLogin = (data) => {
    const u = data.user || data;
    const tok = data.token || null;
    if (tok) localStorage.setItem(TOKEN_KEY, tok);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
    setSignedOut(false);
    setScreen(shouldShowOnboarding(u) ? 'onboard' : 'chat');
  };

  const handleLogout = () => {
    clearStoredSession();
    setUser(null);
    setScreen('login');
    setSignedOut(true);
  };

  const isAdmin = !!(user?.is_admin || user?.role === 'admin');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {screen === 'login' && (
        <LoginScreen onLogin={handleLogin} signedOut={signedOut} onDismissSignedOut={() => setSignedOut(false)} />
      )}
      {screen === 'onboard' && (
        <OnboardScreen user={user} onEnter={() => {
          localStorage.setItem(onboardKeyFor(user), '1');
          sessionStorage.removeItem('siso_force_onboard_once');
          setScreen('chat');
        }} />
      )}
      {screen === 'chat' && (
        <ChatScreen user={user}
          onAdmin={isAdmin ? () => setScreen('admin') : null}
          onLogout={handleLogout}
          onRewatch={() => setScreen('onboard')} />
      )}
      {screen === 'admin' && (
        <AdminScreen user={user} onBack={() => setScreen('chat')} onLogout={handleLogout} onRewatch={() => setScreen('onboard')} />
      )}
    </div>
  );
}
