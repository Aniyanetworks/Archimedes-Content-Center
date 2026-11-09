// The words people see differ from the database's names, which stay as they are:
//   campaign (one sub-account's copy) -> newsletter, edition -> campaign, tenant -> sub-account,
//   "Pause and safety" -> "Settings".
// Applied to messages from the database and server functions, and to labels made from database names.

function caseLike(source: string, word: string): string {
  return source[0] === source[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;
}

const TARGET: Record<string, string> = { campaign: 'newsletter', edition: 'campaign', tenant: 'sub-account' };

export function renameTerms(text: string): string {
  if (!text) return text;
  // Placeholders first, so a word is never renamed twice (campaign -> newsletter, then edition -> campaign).
  let out = text.replace(/Pause and safety/g, '\u0001Settings\u0002').replace(/\b([Aa])n (edition)/g, '$1 $2');
  out = out.replace(/\b(campaign|edition|tenant)(s?)\b/gi, (match, word: string, plural: string) => {
    if (match === match.toUpperCase()) return match; // CONSTANTS stay
    return '\u0001' + caseLike(word, TARGET[word.toLowerCase()] + plural) + '\u0002';
  });
  return out.replace(/[\u0001\u0002]/g, '');
}
