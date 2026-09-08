import { describe, expect, it } from 'vitest';
import { claimsFactuallyCompatible } from '../src/analyzer/claim-match';
import { textTokens } from '../src/analyzer/text-match';
import { extractKeyClaims } from '../src/analyzer/claims';

describe('factual constraints on lexical claim matching', () => {
  it.each([
    ['Revenue increased by 90%.', 'Revenue increased by 10%.'],
    ['Each device needs 1 battery.', 'Each device needs 2 batteries.'],
    ['The measured value was 1.5.', 'The measured value was 15.'],
    [
      'The measured value was 0.10000000000000001.',
      'The measured value was 0.1.',
    ],
    ['The measured value was -5.', 'The measured value was 5.'],
    ['The dose was 5 mg.', 'The dose was 5 g.'],
    ['The latency was 10 ms.', 'The latency was 10 s.'],
    ['The temperature reached 20°C.', 'The temperature reached 20°F.'],
    ['Temperature increased by 10°C/min.', 'Temperature increased by 10°C/h.'],
    ['The system transmitted 10 MB.', 'The system transmitted 10 Mb.'],
    ['The system consumed 10 mW.', 'The system consumed 10 MW.'],
    ['The speed reached 10 km/h.', 'The speed reached 10 km/s.'],
    ['The cost reached $10.', 'The cost reached €10.'],
    ['The increase was 10 percent.', 'The increase was 10 percentage points.'],
    ['The study was published in 2024.', 'The study was published in 2025.'],
    [
      'The study was published on 2025-05-06.',
      'The study was published on 2025-06-05.',
    ],
    [
      'The study was published on January 5.',
      'The study was published on February 5.',
    ],
    ['Revenue rose from 10 to 90.', 'Revenue rose from 90 to 10.'],
    ['The dose is at least 10 mg.', 'The dose is at most 10 mg.'],
    [
      'The intervention does reduce errors.',
      'The intervention does not reduce errors.',
    ],
    [
      'Проверка повышает качество решения.',
      'Проверка не повышает качество решения.',
    ],
    [
      'Revenue increased after the intervention.',
      'Revenue decreased after the intervention.',
    ],
    [
      'Доход компании вырос после реформы.',
      'Доход компании упал после реформы.',
    ],
    [
      'The treatment is safe for adults.',
      'The treatment is unsafe for adults.',
    ],
    [
      'The treatment is effective for adults.',
      'The treatment is ineffective for adults.',
    ],
    [
      'Smoking does not cause cancer but alcohol does.',
      'Smoking causes cancer but alcohol does not.',
    ],
    ['The study found a reduction of 10%.', 'The study found a reduction.'],
    [
      'The system guarantees delivery within 20 seconds for every accepted request.',
      'The system may deliver within 20 seconds for some accepted requests.',
    ],
    [
      'The system delivers every accepted request.',
      'The system delivers some accepted requests.',
    ],
    [
      'Система гарантирует доставку запроса за 20 секунд.',
      'Система может доставить запрос за 20 секунд.',
    ],
    [
      'Production AI evaluation requires representative benchmarks and explicit failure analysis.',
      'Production AI evaluation may require representative benchmarks and explicit failure analysis before deployment decisions can be trusted.',
    ],
    [
      'Production AI evaluation requires representative benchmarks and explicit failure analysis.',
      'Production AI evaluation requires representative benchmarks and explicit failure analysis before deployment decisions cannot be trusted.',
    ],
    [
      'Structured review reduced observed decision errors by 10 percent.',
      'Structured review reduced observed decision errors by 10 percent because other reviewers can reduce errors by 90 percent.',
    ],
  ])('does not treat changed facts as known: %s / %s', (left, right) => {
    expect(claimsFactuallyCompatible(left, right)).toBe(false);
    expect(claimsFactuallyCompatible(right, left)).toBe(false);
  });

  it.each([
    [
      'Production AI evaluation requires representative benchmarks and explicit failure analysis.',
      'Production AI evaluation requires representative benchmarks and explicit failure analysis before deployment decisions can be trusted. I use both as release gates.',
    ],
    [
      'Review reduced errors by 10%.',
      'Errors were reduced by 10 percent after review.',
    ],
    ['The dose was 5 mg.', 'A dose of 5 milligrams was used.'],
    ['The value was 1.50.', 'The observed value was 1,5.'],
    ['The dose is at least 10 mg.', 'The dose is >= 10 mg.'],
    [
      'The intervention did not reduce errors.',
      "The intervention didn't reduce errors.",
    ],
    ['The temperature reached −5°C.', 'The temperature reached -5°C.'],
    ['Доля составила 10%.', 'Доля составила ١٠٪.'],
    ['In 2025, revenue grew by 90%.', 'In 2025, revenue increased by 90%.'],
    [
      'The system guarantees delivery for every request.',
      'Delivery is guaranteed by the system for each request.',
    ],
  ])(
    'preserves compatible numerical and wording variants: %s / %s',
    (left, right) => {
      expect(claimsFactuallyCompatible(left, right)).toBe(true);
    },
  );

  it('retains short quantities, units and negative words as matching tokens', () => {
    const tokens = textTokens('1 10 90% 1.5 -5 mg не no');
    for (const token of ['1', '10', '90', '%', '1.5', '-5', 'mg', 'не', 'no']) {
      expect(tokens.has(token), token).toBe(true);
    }
  });

  it('retains contradictory claims instead of deduplicating away the difference', () => {
    const sentences = [
      'A controlled field experiment found that structured review reduced decision errors by 90 percent.',
      'A controlled field experiment found that structured review reduced decision errors by 10 percent.',
      'A controlled field experiment found that structured review did not reduce decision errors at all.',
    ];
    const claims = extractKeyClaims(
      sentences.join('\n'),
      'Structured review and decision errors',
      'en',
    );
    for (const sentence of sentences)
      expect(claims.some((claim) => claim.claim === sentence)).toBe(true);
  });
});
