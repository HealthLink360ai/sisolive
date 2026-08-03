// ---- Answer text parsing ----
// Ported verbatim from index.html (~lines 2715-2754)

export function cleanSourceName(raw) {
  if (!raw) return null;
  return raw
    .replace(/\.(pdf|docx|doc|txt|csv|pptx|xlsx)$/i, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseAnswer(text) {
  if (!text) return { paragraphs: [], takeaway: null, sourceInText: null };

  // Extract inline Source: line that Claude writes at the end
  const sourceRx = /(?:^|\n)Source:\s*(.+?)(?:\n|$)/i;
  const sourceMatch = text.match(sourceRx);
  const sourceInText = sourceMatch ? sourceMatch[1].trim() : null;
  let body = sourceMatch ? text.replace(sourceMatch[0], '').trim() : text;

  // Split "The bottom line:" off — it always appears as its own sentence
  const bottomRx = /(?:^|\n)(The bottom line:\s*.+?)(?:\n|$)/i;
  const bottomMatch = body.match(bottomRx);
  let takeaway = null;
  if (bottomMatch) {
    const raw = bottomMatch[1].replace(/^the bottom line:\s*/i, '').trim();
    takeaway = raw.charAt(0).toUpperCase() + raw.slice(1);
    body = body.replace(bottomMatch[0], '').trim();
  }

  // Split remaining text into paragraphs (single or double newlines)
  const rawParagraphs = body.split(/\n+/).map(p => p.trim()).filter(Boolean);

  // Tag paragraphs: detect example/illustration markers
  const exampleRx = /^(Think of it this way:|Here['']?s a practical example:|Building on what we covered)/i;
  const paragraphs = rawParagraphs.map(p => ({
    text: p,
    isExample: exampleRx.test(p),
  }));

  return { paragraphs, takeaway, sourceInText };
}
// ---- end answer parsing ----
