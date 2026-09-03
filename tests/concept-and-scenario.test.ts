import { describe, expect, it } from 'vitest';
import { textMatchScore, textTokens } from '../src/analyzer/text-match';
import { scenarioSignalWeight } from '../src/scenario/signal-weights';

describe('cross-language concepts', () => {
  it('matches the same concept across supported interface languages', () => {
    expect(
      textMatchScore(
        'machine learning research',
        'Neue Forschung zum maschinellen Lernen',
      ),
    ).toBeGreaterThan(0);
    expect(
      textMatchScore('искусственный интеллект', '人工智能的发展与风险'),
    ).toBe(1);
    expect(textTokens('تعلم الآلة').has('concept:machine_learning')).toBe(true);
  });

  it('does not count a same-language alias twice', () => {
    expect(
      textMatchScore('rigorous actionable AI research', 'an AI opinion'),
    ).toBe(1 / 3);
  });
});

describe('scenario signal priors', () => {
  it('downweights cross-context evidence instead of switching it off', () => {
    const workGoal = scenarioSignalWeight('work', 'goal');
    const relaxGoal = scenarioSignalWeight('relax', 'goal');
    expect(relaxGoal).toBeGreaterThan(0);
    expect(relaxGoal).toBeLessThan(workGoal);

    const relaxPreference = scenarioSignalWeight('relax', 'leisurePreference');
    expect(relaxPreference).toBeGreaterThan(
      scenarioSignalWeight('work', 'leisurePreference'),
    );
  });
});
