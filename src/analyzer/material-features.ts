import {
  canonicalizeHistoryPage,
  fingerprintHistoryUrl,
  type CanonicalHistoryPage,
} from '../history/evidence';
import type { PageCapture } from '../shared/types';
import { textTokens } from './text-match';

/**
 * Immutable features shared by every personal evidence source for one article.
 * Building this once prevents each connector from tokenizing and canonicalizing
 * the same material independently.
 */
export interface MaterialFeatures {
  matchingText: string;
  matchingTokens: Set<string>;
  canonicalPage: CanonicalHistoryPage | null;
  urlFingerprint: string | null;
  articleTextFingerprint: string;
  headingSummary: string;
}

export function stableTextFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export function articleTextFingerprint(material: PageCapture): string {
  return stableTextFingerprint(
    [
      material.title,
      material.excerpt,
      ...material.headings,
      material.content,
      material.wordCount,
      material.extractionMethod,
    ].join('\n'),
  );
}

export async function buildMaterialFeatures(
  material: PageCapture,
): Promise<MaterialFeatures> {
  const headingSummary = [
    material.title,
    material.excerpt,
    ...material.headings,
  ]
    .join(' ')
    .trim();
  const matchingText = [headingSummary, material.content.slice(0, 14_000)]
    .join(' ')
    .trim();
  const canonicalPage = canonicalizeHistoryPage(material.url, material.title);
  const urlFingerprint = canonicalPage
    ? await fingerprintHistoryUrl(canonicalPage.canonicalUrl)
    : null;
  return {
    matchingText,
    matchingTokens: textTokens(matchingText),
    canonicalPage,
    urlFingerprint,
    articleTextFingerprint: articleTextFingerprint(material),
    headingSummary,
  };
}
