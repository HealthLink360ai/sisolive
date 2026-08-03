import { parseAnswer } from '../../utils/answerParsing.js';

// Ported verbatim from index.html (~lines 2756-2779)
export default function AnswerBody({ text }) {
  const { paragraphs, takeaway, sourceInText } = parseAnswer(text);

  // Fallback: render plain if nothing was parsed
  if (!paragraphs.length && !takeaway) {
    return <div className="ai-card-body">{text}</div>;
  }

  return (
    <div className="ai-card-body parsed">
      {paragraphs.map((p, i) =>
        p.isExample
          ? <div key={i} className="answer-example">{p.text}</div>
          : <p key={i} className="answer-p">{p.text}</p>
      )}
      {takeaway && (
        <div className="answer-takeaway">
          <span className="answer-takeaway-label">The bottom line</span>
          <span className="answer-takeaway-text">{takeaway}</span>
        </div>
      )}
    </div>
  );
}
