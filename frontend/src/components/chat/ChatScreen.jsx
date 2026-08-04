import { useEffect, useRef, useState } from 'react';
import Icons from '../icons/Icons.jsx';
import NavAccount from '../shared/NavAccount.jsx';
import AnswerBody from '../shared/AnswerBody.jsx';
import ConfidenceArc from '../shared/ConfidenceArc.jsx';
import { ChatAPI } from '../../api/chat.js';
import { parseAnswer, cleanSourceName } from '../../utils/answerParsing.js';

/* ============================================================
   CHAT SCREEN
   Ported from index.html (~lines 3189-3589).

   Props:
     user      — { name, email, initials?, role?, department? } | null
     onAdmin   — optional () => void, shows "Admin dashboard" nav link
     onLogout  — () => void
     onRewatch — optional () => void, "Rewatch orientation"

   Fixes applied per prior audit (see task notes):
   1. The hidden Share/More action buttons (source ~lines 3365-3368,
      wrapped in style={{ display: 'none' }}, no onClick handlers)
      are dead code and were dropped entirely.
   2. The "⌘ K" keyboard-shortcut hint badge next to "New conversation"
      (source ~line 3326) is dropped — no keydown/metaKey listener in
      the source ever implements this shortcut. The button's onClick
      (start a new conversation) is kept.
   3. The "Sourced from verified AbbVie docs" badge (source ~lines
      3361-3364) rendered unconditionally in the source, including
      during/after an escalated or low-confidence response. Here it
      only renders once the conversation has at least one real
      answered (non-escalated) message, and is suppressed whenever
      the most recent AI response was an escalation.
   4. The dead `chars: null` field (source ~line 3253), set on the
      error-message object but never read anywhere, was dropped.
   5. Fixed a real correctness bug found in a pre-delivery QA pass:
      this component used to additionally gate real-answer rendering
      on `conf >= 45`, a threshold invented client-side that doesn't
      exist anywhere in the backend. The backend's own confidence
      threshold defaults to 0.25 (capped at 0.35 even if configured
      higher — see retrieval.service.js), and `shouldEscalate` is only
      ever true for zero-retrieved-chunks, an out-of-scope question,
      or Claude's own judgment that context is insufficient — never
      based on the raw score crossing 45%. A legitimate, fully
      generated, backend-approved answer routinely carries a
      confidence in the 25-44% range, and the old `>= 45` gate would
      silently discard it client-side and show the "contact support"
      escalation card instead, even though the backend never asked
      for that. `shouldEscalate` (here: `msg.escalated`) is now the
      sole signal for which card renders — `msg.conf` is displayed as
      informational data only, never used to decide what to show.
   ============================================================ */
export default function ChatScreen({ user, onAdmin, onLogout, onRewatch }) {
  const initials = user ? (user.initials || (user.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U') : 'U';
  const firstName = user ? (user.name || '').split(' ')[0] || 'there' : 'there';

  const [messages, setMessages] = useState([{
    id: 1, role: 'ai',
    text: `Hello ${firstName}, I'm SISO Live!, your precision learning tool for Supplier Inclusion & Sustainability. What would you like to explore today?`,
    conf: null, source: null, nudge: null, feedback: null, showComment: false, comment: ''
  }]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const endRef = useRef();

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, typing]);

  const chips = [
    'What is supplier inclusion and how is it different from supplier diversity?',
    'What are AbbVie\'s four pillars of supplier inclusion?',
    'How does AbbVie measure and track supplier inclusion progress?',
    'What role does environmental stewardship play in AbbVie\'s supplier strategy?',
  ];

  // Fix 3: verified badge should only show once at least one real, confident,
  // non-escalated answer exists in the conversation, and it must be suppressed
  // during/right after an escalation (i.e. when the latest AI reply escalated).
  const hasAnsweredMessage = messages.some(
    (m) => m.role === 'ai' && m.conf !== null && !m.escalated
  );
  const lastAiMessage = [...messages].reverse().find((m) => m.role === 'ai');
  const lastWasEscalated = !!lastAiMessage && lastAiMessage.conf !== null && lastAiMessage.escalated;
  const showVerifiedBadge = hasAnsweredMessage && !lastWasEscalated;

  const sendMessage = async (text) => {
    const q = text || input.trim();
    if (!q) return;
    setInput('');
    const newMsg = { id: Date.now(), role: 'user', text: q };
    setMessages((m) => [...m, newMsg]);
    setTyping(true);
    try {
      const history = messages
        .filter(m => m.role === 'user' || (m.role === 'ai' && m.text))
        .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text || '' }))
        .filter(m => m.content);
      const result = await ChatAPI.query(q, history);
      setTyping(false);
      const answer = result.answer || result.text || null;
      const conf = result.confidencePercent != null
        ? result.confidencePercent
        : result.confidence != null
          ? Math.round(result.confidence * 100)
          : (answer ? 95 : 60);
      const escalated = result.shouldEscalate === true;
      // Extract source: try parsed text first, then top API source
      const { sourceInText } = parseAnswer(!escalated ? answer : null);
      const apiSource = result.sources?.[0]?.filename || null;
      setMessages((m) => [...m, {
        id: result.queryId || Date.now() + 1, role: 'ai',
        text: !escalated ? answer : null,
        conf, escalated,
        source: sourceInText || apiSource || null,
        nudge: result.nudge || null,
        feedback: null, showComment: false, comment: '',
      }]);
    } catch (e) {
      setTyping(false);
      // Show actual server error so issues are diagnosable; fall back to generic for network failures
      const msg = (e.message && e.message !== 'Query failed' && e.message !== 'Failed to fetch')
        ? e.message
        : "I'm having trouble connecting right now. Please try again in a moment.";
      setMessages((m) => [...m, {
        id: Date.now() + 1, role: 'ai',
        text: msg,
        conf: null, source: null, nudge: null,
        feedback: null, showComment: false, comment: '',
      }]);
    }
  };

  const setFeedback = (id, val) => {
    setMessages((m) => m.map((msg) =>
      msg.id === id ? { ...msg, feedback: val, showComment: val === 'down', feedbackError: false } : msg
    ));
    // For thumbs-up, log immediately (no comment needed).
    // For thumbs-down, wait for submitComment so the comment is included.
    if (val !== 'down') {
      const msg = messages.find(m => m.id === id);
      if (msg) {
        // "Thanks, logged" is only ever shown once this actually resolves —
        // a failed request now flips feedbackError so the UI reflects what
        // really happened instead of unconditionally claiming success.
        ChatAPI.feedback(id, val, '').catch(() => {
          setMessages((m) => m.map((msg) => msg.id === id ? { ...msg, feedbackError: true } : msg));
        });
      }
    }
  };

  const submitComment = (id) => {
    const msg = messages.find(m => m.id === id);
    setMessages((m) => m.map((msg) =>
      msg.id === id ? { ...msg, showComment: false, feedbackError: false } : msg
    ));
    if (msg) {
      ChatAPI.feedback(id, 'down', msg.comment).catch(() => {
        setMessages((m) => m.map((msg) => msg.id === id ? { ...msg, feedbackError: true } : msg));
      });
    }
  };

  const updateComment = (id, val) => {
    setMessages((m) => m.map((msg) => msg.id === id ? { ...msg, comment: val } : msg));
  };

  const nowStr = () => {
    const d = new Date();
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  };

  return (
    <div className="app-shell">
      <div className="nav-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="nav-top-logo">
            <div className="nav-org"><img src="/assets/abbvie-logo-white.png" alt="AbbVie" /></div>
            <div className="nav-sep"></div>
            <span className="nav-wordmark">SISO<span className="live">Live!</span></span>
          </div>
          <span className="nav-build"></span>
        </div>
        <div className="nav-links">
          <div className="nav-link active">Learning tool</div>
          {onAdmin && <div className="nav-link" onClick={onAdmin} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onAdmin()}>Admin dashboard</div>}
        </div>
        <div className="nav-right">
          <div className="nav-status">
            <div className="nav-status-dot" />
            Live environment
          </div>
          <NavAccount user={user} onLogout={onLogout} onRewatch={onRewatch} />
        </div>
      </div>

      <div className="chat-screen">
        <div className="sidebar">
          <div className="sidebar-top">
            <button className="new-conv-btn" onClick={() => {
              setMessages([{
                id: Date.now(), role: 'ai',
                text: `Hello ${firstName}, I'm SISO Live!, your precision learning tool for Supplier Inclusion & Sustainability. What would you like to explore today?`,
                conf: null, source: null, nudge: null, feedback: null, showComment: false, comment: ''
              }]);
              setInput('');
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 14, height: 14, color: 'var(--text-2)' }}><Icons.plus /></div>
                New conversation
              </span>
            </button>
          </div>

          <div className="sidebar-body">
            <div className="sidebar-sec">Start here <span className="cnt">{chips.length}</span></div>
            <div className="sidebar-chips">
              {chips.map((c, i) => (
                <div key={c} className="sidebar-chip" onClick={() => sendMessage(c)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && sendMessage(c)}>
                  <span className="chip-mark">0{i + 1}</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-footer">
            <div className="user-av-side">{initials}</div>
            <div className="user-info-side">
              <div className="n">{user ? (user.name || user.email || 'User') : 'User'}</div>
              <div className="r">{user ? ((user.role || 'User').toUpperCase() + ' · ABBVIE') : 'ABBVIE'}</div>
            </div>
            <div className="chev" style={{ width: 14, height: 14 }}><Icons.chevron /></div>
          </div>
        </div>

        <div className="chat-area">
          <div className="chat-topbar">
            <div className="chat-topbar-left-row">
              <div className="chat-topbar-title">
                Supplier Inclusion &amp; <em>Sustainability</em>
              </div>
              <div className="chat-topbar-meta">SUPPLIER INCLUSION · SESSION</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {showVerifiedBadge && (
                <div className="verified-badge">
                  <div className="verified-dot" />
                  Sourced from verified AbbVie docs
                </div>
              )}
            </div>
          </div>

          <div className="messages">
            <div className="messages-inner">
              {messages.map((msg) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="msg-user">
                      <div className="bubble-user">{msg.text}</div>
                      <div className="msg-user-meta">{initials} · just now</div>
                    </div>
                  );
                }
                return (
                  <div key={msg.id} className="msg-ai">
                    <div className="msg-ai-head">

                      <span className="msg-ai-name">SISO <em>Live!</em></span>
                      <span className="msg-ai-time">{nowStr()}</span>
                    </div>

                    {msg.conf === null && msg.text && (
                      <div className="ai-card">
                        <div className="ai-card-body" style={{ fontSize: 15, lineHeight: 1.7 }}>{msg.text}</div>
                      </div>
                    )}

                    {msg.conf !== null && !msg.escalated && (() => {
                      const { sourceInText } = parseAnswer(msg.text);
                      const displaySource = cleanSourceName(sourceInText || msg.source);
                      return (
                        <div className="ai-card">
                          <AnswerBody text={msg.text} />
                          <div className="ai-card-foot">
                            <div className="conf-gauge">
                              <ConfidenceArc value={msg.conf} />
                              <div className="conf-text">Confidence <b>{msg.conf}%</b></div>
                            </div>
                            {displaySource && (
                              <div className="source-chip" title={displaySource}>
                                <span className="doc-mark"><Icons.files /></span>
                                {displaySource}
                              </div>
                            )}
                            <div className="msg-foot-meta">
                              <span className="foot-meta-pill">Verified source match</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {msg.conf !== null && msg.escalated && (
                      <div className="ai-card">
                        <div className="ai-card-body low-conf">
                          I don't have enough verified information to answer this confidently. For accurate guidance, please reach out to the SISO support desk. They're the right resource for this.
                        </div>
                        <div className="ai-card-foot">
                          <div className="conf-gauge">
                            <ConfidenceArc value={msg.conf} />
                            <div className="conf-text warn">Confidence <b>{msg.conf}%</b> · below threshold</div>
                          </div>
                          <div className="msg-foot-meta">
                            <span className="foot-meta-pill">Escalated to SISO support</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {msg.conf !== null && (
                      <div className="feedback-row">
                        <span className="fb-lbl">Was this helpful?</span>
                        <button
                          className={`fb-btn ${msg.feedback === 'up' ? 'up-on' : ''}`}
                          onClick={() => setFeedback(msg.id, 'up')}
                          aria-label="Thumbs up">
                          <div style={{ width: 14, height: 14 }}><Icons.thumbup /></div>
                        </button>
                        <button
                          className={`fb-btn ${msg.feedback === 'down' ? 'dn-on' : ''}`}
                          onClick={() => setFeedback(msg.id, 'down')}
                          aria-label="Thumbs down">
                          <div style={{ width: 14, height: 14 }}><Icons.thumbdown /></div>
                        </button>
                        {(msg.feedback === 'up' || (msg.feedback === 'down' && !msg.showComment)) && (
                          msg.feedbackError ? (
                            <span className="fb-thanks" style={{ color: 'var(--signal)' }}>
                              <div style={{ width: 11, height: 11 }}><Icons.alert /></div>
                              Couldn't save — try again
                            </span>
                          ) : (
                            <span className="fb-thanks">
                              <div style={{ width: 11, height: 11 }}><Icons.check /></div>
                              Thanks, logged
                            </span>
                          )
                        )}
                      </div>
                    )}

                    {msg.showComment && (
                      <div className="fb-comment-box">
                        <textarea
                          placeholder="What was wrong with this answer? (optional, helps us improve)"
                          value={msg.comment}
                          onChange={(e) => updateComment(msg.id, e.target.value)} />
                        <button className="fb-submit" onClick={() => submitComment(msg.id)}>
                          Submit feedback
                          <div style={{ width: 11, height: 11 }}><Icons.arrow /></div>
                        </button>
                      </div>
                    )}

                    {!msg.escalated && msg.conf !== null && msg.nudge && (
                      <div className="nudge" onClick={() => sendMessage(msg.nudge)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && sendMessage(msg.nudge)}>
                        <div className="nudge-ic"><div style={{ width: 16, height: 16 }}><Icons.sparkles /></div></div>
                        <span>{msg.nudge}</span>
                        <span className="arr">EXPLORE →</span>
                      </div>
                    )}

                    {msg.conf !== null && msg.escalated && (
                      <div className="escalate-card">
                        <div className="escalate-ic"><div style={{ width: 16, height: 16 }}><Icons.headset /></div></div>
                        <div className="escalate-body">
                          <div className="escalate-title">This is best handled by the SISO <em>support team</em>.</div>
                          <div className="escalate-desc">They'll provide a precise, verified answer. Typical response under 24 hours.</div>
                        </div>
                        <a className="escalate-btn" href="mailto:supplierinclusionandsustainability@abbvie.com" style={{ textDecoration: 'none' }}>
                          Contact support
                          <div style={{ width: 10, height: 10 }}><Icons.arrow /></div>
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}

              {typing && (
                <div className="msg-ai">
                  <div className="msg-ai-head">
                    <span className="msg-ai-name">SISO <em>Live!</em></span>
                    <span className="msg-ai-time">retrieving...</span>
                  </div>
                  <div className="ai-card">
                    <div className="typing-bubble">
                      <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                      <span className="typing-label">Searching verified sources</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          <div className="chat-input-area">
            <div className="chat-input-wrap">
              <div className="chat-input-box">
                <div className="chat-input-prefix">
                  <div style={{ width: 16, height: 16 }}><Icons.search /></div>
                </div>
                <input
                  type="text"
                  placeholder="Ask about supplier inclusion or sustainability…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !typing && sendMessage()} />
                <div className="chat-input-actions">
                  <button className="send-btn" onClick={() => sendMessage()} disabled={typing || !input.trim()} aria-label="Send message">
                    <div style={{ width: 14, height: 14 }}><Icons.send /></div>
                  </button>
                </div>
              </div>
              <div className="chat-input-foot">
                <div className="left">
                  <span><div style={{ width: 10, height: 10, display: 'inline-block' }}><Icons.lock /></div> AbbVie internal · encrypted</span>
                  <span>Retrieval over verified sources</span>
                </div>
                <span>Press <span className="kbd">↵</span> to send</span>
              </div>
            </div>
          </div>
        </div>

        <aside className="chat-rail">
          <div className="chat-rail-head">
            <div className="chat-rail-title">SISO<em>Live!</em> Assistant</div>
            <div className="chat-rail-tag">COMPANION</div>
          </div>
          <div className="chat-rail-body">
            <div className={"assistant-stage" + (typing ? " thinking" : "")}>
              <div className="stage-ph" id="stage-placeholder">
                <div className="glyph"><div style={{ width: 22, height: 22 }}><Icons.atom /></div></div>
                <div className="cap"><b>SISO Live! companion</b><br />Your precision-learning assistant</div>
                <div className="slot-hint">Animation loading</div>
              </div>
              <video
                className="gif"
                src="/assets/companion.mp4"
                autoPlay loop muted playsInline
                onLoadedData={(e) => {
                  const ph = document.getElementById('stage-placeholder');
                  if (ph) ph.style.display = 'none';
                }}
                onError={(e) => {
                  e.target.style.display = 'none';
                  const ph = document.getElementById('stage-placeholder');
                  if (ph) ph.style.display = 'flex';
                }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', padding: 0, boxSizing: 'border-box', zIndex: 1, mixBlendMode: 'multiply' }}
              />
              <div className="stage-badge"><span className="bdot" />Thinking…</div>
            </div>
            <div className={"assistant-status" + (typing ? " thinking" : "")}>
              <span className="sdot" />
              {typing ? 'Searching verified sources…' : 'Idle · ready to help'}
            </div>
            <p className="assistant-caption">
              SISO Live! searches AbbVie sources and shows the best verified answer it can support.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
