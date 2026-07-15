import { useState } from 'react';
import Icons from '../icons/Icons.jsx';
import { AuthAPI } from '../../api/auth.js';

// Ported verbatim from index.html (~lines 2860-2998), with one intentional
// change: the source's "Forgot?" span next to the Password label had no
// onClick handler at all (a confirmed dead/non-functional UI element per a
// prior audit). There is no forgot-password backend flow to wire it to, so
// it has been removed here rather than ported as a fake-clickable element.
export default function LoginScreen({ onLogin, signedOut, onDismissSignedOut }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !pass) { setErr('Please enter your email and password.'); return; }
    if (!email.includes('@')) { setErr('Please enter a valid AbbVie email address.'); return; }
    setErr(''); setLoading(true);
    try {
      const data = await AuthAPI.login(email, pass);
      setLoading(false);
      onLogin(data);
    } catch (e) {
      setLoading(false);
      setErr(e.message || 'Sign in failed. Please check your credentials.');
    }
  };

  return (
    <div className="login-screen">
      <div className="login-left fade-in">
        <div className="login-left-top">
          <div className="login-lockup">
            <div className="org-mark"><img src="assets/abbvie-logo-navy.png" alt="AbbVie" /></div>
            <div className="lockup-sep"></div>
            <div className="product">
              <span className="wm">SISO <em>Live!</em></span>
            </div>
          </div>
        </div>

        <div className="login-hero">
          <h1 className="login-headline">
            <span style={{ whiteSpace: 'nowrap' }}>Learning that </span><br />
            <span className="accent" style={{ whiteSpace: 'nowrap' }}>creates impact.</span>
          </h1>
          <p className="login-sub">
            SISO Live! helps AbbVie teams access verified guidance, build
            confidence, and make faster decisions across supplier inclusion
            and sustainability work.
          </p>
          <div className="login-feats">
            <div className="login-feat f-1">
              <div className="ic"><img src="assets/icon-verified.png" alt="" style={{ width: 24, height: 24, mixBlendMode: 'multiply' }} /></div>
              <h5>Verified answers</h5>
              <p>Every response sourced from AbbVie's official supplier inclusion content.</p>
            </div>
            <div className="login-feat f-2">
              <div className="ic"><img src="assets/icon-coaching.png" alt="" style={{ width: 24, height: 24, mixBlendMode: 'multiply' }} /></div>
              <h5>Precision coaching</h5>
              <p>Trainer-style guidance that builds real understanding, not just facts.</p>
            </div>
            <div className="login-feat f-3">
              <div className="ic"><img src="assets/icon-progress.png" alt="" style={{ width: 24, height: 24, mixBlendMode: 'multiply' }} /></div>
              <h5>Track progress</h5>
              <p>Monitor your knowledge growth across all supplier inclusion topics.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="login-bot">
        <img src="assets/abbvie-bot-2.png" alt="AbbVie assistant" />
      </div>

      <div className="login-right fade-up" style={{ padding: "32px 36px 32px 6px" }}>
        <div className="login-card">
          <div className="login-card-inner">
            <h2 className="login-h">Welcome<em>.</em></h2>
            <p className="login-p">Sign in with your AbbVie credentials to continue.</p>

            {signedOut && (
              <div className="signed-out-banner">
                <span className="sob-ic"><Icons.check /></span>
                You've been signed out securely.
                <span className="sob-x" onClick={onDismissSignedOut}><Icons.close /></span>
              </div>
            )}

            {err && (
              <div className="login-error">
                <div style={{ width: 14, height: 14, flexShrink: 0 }}><Icons.alert /></div>
                {err}
              </div>
            )}

            <div className="field">
              <div className="field-label"><span>Work email</span></div>
              <input className="field-inp" type="email" placeholder="firstname.lastname@abbvie.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
            </div>

            <div className="field">
              <div className="field-label">
                <span>Password</span>
              </div>
              <input className="field-inp" type="password" placeholder="••••••••••••"
                value={pass} onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
            </div>

            <button className="btn-primary" onClick={handleLogin} disabled={loading} style={{ width: '100%' }}>
              {loading ? <>Signing in…</> : (
                <>
                  Sign in to SISO Live!
                  <span className="arrow"><div style={{ width: 12, height: 12 }}><Icons.arrow /></div></span>
                </>
              )}
            </button>

            <div className="divider">
              <div className="divider-line" />
              <span className="divider-text">or</span>
              <div className="divider-line" />
            </div>

            <button className="btn-sso" type="button" disabled title="Enterprise SSO will be enabled in the final rollout">
              <div style={{ width: 16, height: 16, color: 'var(--text-on-ink-2)' }}><Icons.shield /></div>
              AbbVie SSO coming soon
            </button>

            <div className="login-card-foot">
              <span>AbbVie Confidential</span>
              <span className="sep"></span>
              <span>SISO Office</span>
            </div>
          </div>
        </div>
        <div className="login-help">
          Need access? <a href="mailto:sisolive@abbvie.com">sisolive@abbvie.com</a>
        </div>
      </div>
    </div>
  );
}
