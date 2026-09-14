import { describe, expect, it } from 'vitest';
import { textMatchScore, textTokens } from '../src/analyzer/text-match';
import { createArticleMap } from '../src/reading/blocks';
import { selectLocalPassages } from '../src/reading/local-passages';
import { claimsFactuallyCompatible } from '../src/analyzer/claim-match';
import { selectRelevantProfileContext } from '../src/profile/relevance';
import { createEmptyProfile } from '../src/profile/schema';
import type { PageCapture, AnalysisContext } from '../src/shared/types';

function article(text: string, caveat: string): PageCapture {
  const map = createArticleMap([
    {
      text: 'Dieser Abschnitt berichtet von einem Konzert und einem Musikfestival am Wochenende in der Innenstadt.',
      section: 'Hintergrund',
      kind: 'paragraph',
    },
    { text, section: 'Praxis', kind: 'paragraph' },
    { text: caveat, section: 'Praxis', kind: 'paragraph' },
  ]);
  return {
    title: 'Praxis und Hintergrund',
    url: 'https://example.com/de',
    content: map.blocks.map((block) => block.text).join('\n\n'),
    excerpt: '',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'de',
    wordCount: 250,
    readingTimeMinutes: 2,
    headings: ['Hintergrund', 'Praxis'],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-09-14',
    readingMap: map,
  };
}
const base: AnalysisContext = {
  scenario: 'work',
  intent: '',
  availableMinutes: 15,
};

describe('German local matching', () => {
  it.each([
    [
      'Methoden vergleichen',
      'Vergleichen Sie die Methode anhand nachvollziehbarer Ergebnisse.',
    ],
    [
      'Antworten prüfen',
      'Die Prüfung der Antwort zeigt einen sachlichen Fehler.',
    ],
    [
      'Risiken von Verträgen',
      'Der Vertrag enthält mehrere finanzielle Risiken.',
    ],
    [
      'Rezepte und Zutaten',
      'Für dieses Rezept ist die Zutat frisch zu verarbeiten.',
    ],
    [
      'Wissenschaftliche Studien',
      'Die wissenschaftlichen Studien liefern übereinstimmende Ergebnisse.',
    ],
  ])('matches useful inflections: %s', (goal, text) => {
    expect(textMatchScore(goal, text)).toBeGreaterThan(0);
  });

  it('does not count German function words as topical evidence or strip English suffixes', () => {
    expect(
      textMatchScore('für die von und einer', 'für die von und einer'),
    ).toBe(0);
    expect(textTokens('other water computer')).toEqual(
      new Set(['other', 'water', 'computer']),
    );
    expect(textTokens('Die Prüfung ist nicht zuverlässig.')).toContain('nicht');
  });

  it.each([
    [
      'Methoden vergleichen und Antworten prüfen',
      'Vergleichen Sie die Methode für die Prüfung der Antworten anhand getrennter Beispiele. Erfassen Sie dabei die Fehler und ihre Ursachen.',
      'Dies gilt nur, wenn die Beispiele die späteren Aufgaben ausreichend abdecken.',
    ],
    [
      'Risiken und Renditen vergleichen',
      'Vergleichen Sie das Risiko einer Anlage mit ihrer Rendite, den Kosten und der geplanten Laufzeit, bevor Sie eine Entscheidung treffen.',
      'Allerdings sind frühere Ergebnisse keine Garantie für die künftige Rendite.',
    ],
    [
      'Nebenwirkungen einer Behandlung',
      'Die Behandlung kann Nebenwirkungen verursachen. In der Studie wurden Häufigkeit und Schwere getrennt erfasst und mit der Kontrollgruppe verglichen.',
      'Jedoch lassen sich diese Ergebnisse nicht ohne weitere Untersuchungen auf Kinder übertragen.',
    ],
  ])(
    'selects a relevant German passage with its qualification: %s',
    (goal, useful, caveat) => {
      const material = article(useful, caveat);
      const selection = selectLocalPassages(
        material,
        { ...base, intent: goal },
        null,
      );
      expect(selection.items).toHaveLength(1);
      expect(selection.items[0]?.coreBlockId).toBe(
        material.readingMap!.blocks[1]!.id,
      );
      expect(selection.items[0]?.blockIds).toContain(
        material.readingMap!.blocks[2]!.id,
      );
      expect(selection.items[0]?.knowledge).toBe('unknown');
      expect(
        selectLocalPassages(
          material,
          { ...base, intent: 'Geschichte mittelalterlicher Städte' },
          null,
        ).items,
      ).toEqual([]);
    },
  );

  it('connects a German profile to an English article without matching an unrelated AI topic', () => {
    const profile = createEmptyProfile();
    profile.interests.push({
      id: 'de-interest',
      topic: 'KI',
      strength: 0.9,
      confidence: 1,
      sources: [],
    });
    const material = article(
      'Model evaluation should compare response errors across independent datasets. Data quality depends on checking incorrect labels before testing the model.',
      'However, the datasets must represent the actual users.',
    );
    material.title = 'AI model evaluation and data quality';
    material.language = 'en';
    expect(
      selectRelevantProfileContext(profile, material, base)?.signals.some(
        (signal) => signal.label === 'KI',
      ),
    ).toBe(true);
    expect(
      selectLocalPassages(
        material,
        { ...base, intent: 'Modellbewertung und Datenqualität' },
        null,
      ).items,
    ).toHaveLength(1);
    expect(
      selectLocalPassages(
        material,
        { ...base, intent: 'KI und Aktienkurse' },
        null,
      ).items,
    ).toEqual([]);
  });

  it('does not confuse German units or negated claims', () => {
    expect(
      claimsFactuallyCompatible(
        'Die Prüfung dauert 5 Minuten.',
        'Die Prüfung dauert 5 Stunden.',
      ),
    ).toBe(false);
    expect(
      claimsFactuallyCompatible(
        'Die Prüfung ist zuverlässig.',
        'Die Prüfung ist nicht zuverlässig.',
      ),
    ).toBe(false);
  });
});
