import { useState } from 'react';

// Ported verbatim from index.html (~lines 3005-3025)
export default function OnboardStepCard({ num, label, heading, body }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      className={'onboard-step-wrapper' + (flipped ? ' flipped' : '')}
      onClick={() => setFlipped(f => !f)}
      role="button"
      tabIndex={0}
      aria-label={`${label} — ${flipped ? 'showing details, press Enter to flip back' : 'press Enter for details'}`}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setFlipped(f => !f))}
    >
      <div className="onboard-step-inner">
        <div className="onboard-step onboard-step-front">
          <div className="onboard-step-num">{num}</div>
          <div className="onboard-step-label">{label}</div>
          <div className="onboard-step-heading">{heading}</div>
          <div className="onboard-step-hint">Click to learn more →</div>
        </div>
        <div className="onboard-step onboard-step-back">
          <div className="onboard-step-num">{num}</div>
          <div className="onboard-step-label">{label}</div>
          <p className="onboard-step-body">{body}</p>
          <div className="onboard-step-hint">← Flip back</div>
        </div>
      </div>
    </div>
  );
}
