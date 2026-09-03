import { describe, expect, it } from 'vitest';
import { extractKeyClaims } from '../src/analyzer/claims';
import {
  countLanguageMarkers,
  resolveHeuristicLanguage,
  SUPPORTED_HEURISTIC_LANGUAGES,
} from '../src/analyzer/language-heuristics';

describe('language heuristic packs', () => {
  it('supports every public interface language as an analysis language', () => {
    expect(SUPPORTED_HEURISTIC_LANGUAGES).toEqual([
      'en',
      'ru',
      'de',
      'es',
      'fr',
      'it',
      'zh',
      'ar',
      'hi',
    ]);
  });

  it('uses content language when browser translation contradicts metadata', () => {
    const translated = resolveHeuristicLanguage(
      'en-US',
      'Это переведённый текст статьи, потому что пользователь включил перевод. Исследование и данные теперь показаны на русском языке. '.repeat(
        8,
      ),
    );

    expect(translated.heuristicLanguage).toBe('ru');
    expect(translated.source).toBe('content');
    expect(translated.supported).toBe(true);
  });

  it('recognizes evidence and reasoning in German and Chinese', () => {
    const germanText =
      'Eine Studie mit 420 Fällen zeigt klare Ergebnisse, weil die Prüfung Fehler reduziert.';
    const german = resolveHeuristicLanguage('de', germanText);
    expect(
      countLanguageMarkers(germanText, 'evidence', german),
    ).toBeGreaterThan(0);
    expect(
      countLanguageMarkers(germanText, 'reasoning', german),
    ).toBeGreaterThan(0);

    const chineseText =
      '研究使用了420个样本，因为检查机制会减少错误，因此结果更稳定。';
    const chinese = resolveHeuristicLanguage('zh-CN', chineseText);
    expect(
      countLanguageMarkers(chineseText, 'evidence', chinese),
    ).toBeGreaterThan(0);
    expect(
      countLanguageMarkers(chineseText, 'reasoning', chinese),
    ).toBeGreaterThan(0);
  });

  it('keeps unsupported languages explicit and still extracts claims', () => {
    const dutch = [
      'Een zorgvuldige beoordeling van bronnen maakt complexe beslissingen betrouwbaarder voor professionele teams.',
      'De analyse van 240 projecten in 2025 vond een verbetering van 18 procent bij onafhankelijke controle.',
    ].join(' ');
    const language = resolveHeuristicLanguage('nl', dutch);
    const claims = extractKeyClaims(dutch, 'Betrouwbare beslissingen', 'nl');

    expect(language.supported).toBe(false);
    expect(language.heuristicLanguage).toBeNull();
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.some((claim) => claim.type === 'fact')).toBe(true);
  });
});
