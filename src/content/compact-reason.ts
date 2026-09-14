/** A bounded preview; the complete explanation remains in the card details. */
export function compactReason(value: string, maximum = 320): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  if (text.length <= maximum) return text;
  const prefix = text.slice(0, maximum - 2);
  const sentenceEnd = [...prefix.matchAll(/[.!?。！？](?:\s|$)/gu)].at(-1);
  if (sentenceEnd && sentenceEnd.index! >= maximum / 2)
    return `${prefix.slice(0, sentenceEnd.index! + 1)} …`;
  const wordEnd = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, wordEnd > maximum / 2 ? wordEnd : prefix.length).trimEnd()}…`;
}
