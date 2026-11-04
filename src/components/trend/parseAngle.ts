export interface AngleBlock { title: string; ideas: string[]; warning?: boolean }
type PageAngle = { fanpageId?: string; pageName?: string; angle: string };
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

/** Splits only outside paired quotes; preserves punctuation and wording. */
export function splitAngleIdeas(text: string): string[] {
  const parts: string[] = []; let start = 0; let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (i === 0 || text[i - 1] !== '\\')) quote = quote === '"' ? '' : quote || '"';
    else if (c === '“' && !quote) quote = '”';
    else if (c === '”' && quote === '”') quote = '';
    if (!quote && (c === ';' || (c === '.' && /\s/.test(text[i + 1] || '')))) {
      const part = text.slice(start, i + 1).trim(); if (part) parts.push(part); start = i + 1;
    }
  }
  const tail = text.slice(start).trim(); if (tail) parts.push(tail);
  return parts;
}
export function parseSuggestedAngle(text: string, pageNames: string[] = []): AngleBlock[] {
  const markers: { start: number; end: number; title: string; warning: boolean }[] = [];
  // A heading begins at the start or after a sentence/semicolon, never inside quotation marks.
  const re = /(?:^|[.;]\s+|\n+)\s*([^:;\n.!?]{2,100}):/g;
  for (const m of text.matchAll(re)) {
    const title = m[1].trim(); const n = normalize(title);
    const warning = ['tranh', 'can tranh', 'luu y', 'khong nen'].includes(n);
    const known = pageNames.find(name => normalize(name) === n);
    const uppercase = /[\p{L}]/u.test(title) && title === title.toLocaleUpperCase('vi-VN');
    if (!warning && !known && !uppercase) continue;
    const start = (m.index ?? 0) + m[0].indexOf(m[1]);
    // Reject headings within quotes, including quoted colons and sentence punctuation.
    const before = text.slice(0, start); const straight = (before.match(/(?<!\\)"/g) || []).length;
    if (straight % 2 || (before.match(/“/g) || []).length > (before.match(/”/g) || []).length) continue;
    markers.push({ start, end: (m.index ?? 0) + m[0].length, title: warning ? 'Cần tránh' : known || title.toLocaleLowerCase('vi-VN').replace(/(^|\s)\p{L}/gu, x => x.toLocaleUpperCase('vi-VN')), warning });
  }
  const blocks: AngleBlock[] = [];
  const add = (title: string, content: string, warning = false) => { const ideas = splitAngleIdeas(content); if (ideas.length) blocks.push({ title, ideas, ...(warning ? { warning } : {}) }); };
  if (!markers.length) add('Gợi ý chung', text);
  else {
    add('Gợi ý chung', text.slice(0, markers[0].start));
    markers.forEach((m, i) => add(m.title, text.slice(m.end, markers[i + 1]?.start ?? text.length), m.warning));
  }
  return blocks;
}
export function angleBlocks(brief: { suggestedAngle?: string; pageAngles?: PageAngle[]; avoid?: string[] }, pages: { id: string; pageName: string }[] = []): AngleBlock[] {
  const names = pages.map(p => p.pageName);
  const blocks: AngleBlock[] = brief.pageAngles?.length ? brief.pageAngles.flatMap(a => {
    const title = a.pageName || pages.find(p => p.id === a.fanpageId)?.pageName || 'Gợi ý chung';
    const ideas = splitAngleIdeas(a.angle || ''); return ideas.length ? [{ title, ideas }] : [];
  }) : parseSuggestedAngle(brief.suggestedAngle || '', names);
  if (brief.avoid?.length) return [...blocks.filter(b => !b.warning), { title: 'Cần tránh', ideas: brief.avoid, warning: true }];
  return blocks;
}
