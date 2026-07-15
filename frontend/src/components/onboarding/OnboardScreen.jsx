import Icons from '../icons/Icons.jsx';
import OnboardStepCard from './OnboardStepCard';

// Ported verbatim from index.html (~line 3003)
const VIMEO_EMBED = 'https://player.vimeo.com/video/1203654369?h=5636fcee24&title=0&byline=0&portrait=0';

// Ported verbatim from index.html (~lines 3027-3097)
export default function OnboardScreen({ user, onEnter }) {
  return (
    <div className="onboard-screen">
      <div className="onboard-inner fade-up">
        <div className="onboard-top">
          <div className="onboard-brand">
            <img src="assets/abbvie-logo-navy.png" alt="AbbVie" style={{ height: 22, mixBlendMode: 'multiply' }} />
            <span className="name">SISO <em>Live!</em></span>
          </div>
          <div className="onboard-skip-link" onClick={onEnter}>
            Skip <div style={{ width: 11, height: 11 }}><Icons.arrow /></div>
          </div>
        </div>

        <div className="onboard-hero">
          <div className="onboard-eyebrow">
            <span className="step">Orientation</span>
            Before you begin
          </div>
          <h1 className="onboard-h">Supplier inclusion and sustainability: <br /><em>What it means at AbbVie.</em></h1>
        </div>

        <div className="onboard-video-hero">
          <div className="onboard-video-embed">
            <iframe
              src={VIMEO_EMBED}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              title="SISO Live! Supplier Inclusion and Sustainability Overview"
            />
          </div>
          <div className="onboard-video-caption">
            <div style={{ width: 9, height: 9 }}><Icons.spark /></div>
            2 min · AbbVie SISO Office · Watch before getting started
          </div>
        </div>

        <div className="onboard-steps">
          <OnboardStepCard
            num="STEP 01"
            label="Supplier Inclusion"
            heading="Expanding who AbbVie does business with"
            body="Supplier inclusion is AbbVie's commitment to actively partnering with businesses owned by underrepresented groups, including minority, women, veteran, LGBTQ+, and disability-owned enterprises. It's a strategic priority to broaden our supply chain, strengthen communities, and bring diverse perspectives to how AbbVie operates."
          />
          <OnboardStepCard
            num="STEP 02"
            label="Sustainability"
            heading="Responsible sourcing beyond the bottom line"
            body="AbbVie's sustainability goals focus on environmental stewardship: reducing carbon emissions, water usage, and waste, while measuring the social and governance impact of our supply chain decisions. Together, supplier inclusion and sustainability form the foundation of how AbbVie creates long-term value."
          />
          <OnboardStepCard
            num="STEP 03"
            label="SISO Live!"
            heading="Your precision learning coach"
            body="SISO Live! gives you instant, verified answers from AbbVie's official supplier inclusion content. Ask in plain language, get grounded responses, and follow suggested questions to build real understanding, not just information."
          />
        </div>

        <div className="onboard-cta-row">
          <div className="onboard-cta-meta">
            Welcome, <b>{user && user.name ? user.name.split(' ')[0] : 'there'}</b>
          </div>
          <button className="btn-primary" onClick={onEnter}>
            Enter SISO Live!
            <span className="arrow"><div style={{ width: 11, height: 11 }}><Icons.arrow /></div></span>
          </button>
        </div>
      </div>
    </div>
  );
}
