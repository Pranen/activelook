// The built-in fonts only contain printable ASCII (32–126).

const MAP: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss',
  'æ': 'ae', 'Æ': 'Ae', 'ø': 'o', 'Ø': 'O', 'œ': 'oe', 'Œ': 'Oe',
  '–': '-', '—': '-', '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '„': '"',
  '«': '"', '»': '"', '…': '...', '•': '*', '·': '-', '€': 'EUR', '×': 'x',
  ' ': ' ', ' ': ' ', '\t': ' ', '\n': ' ', '\r': '',
};

/** Converts text to printable ASCII: umlauts → ae/oe/ue, accents stripped, rest → `fallback`. */
export function toAscii(text: string, fallback = '?'): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) { out += ch; continue; }
    const mapped = MAP[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base && /^[\x20-\x7e]+$/.test(base) ? base : fallback;
  }
  return out;
}
