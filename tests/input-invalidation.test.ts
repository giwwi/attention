import { expect, it } from 'vitest';
import { changedInputKeys } from '../src/background/input-invalidation';

it('invalidates recommendations for inputs and excludes analysis outputs and keys', () => {
  expect(
    changedInputKeys(
      {
        personalProfile: {},
        attentionScenario: {},
        savedMaterials: {},
        latestEvaluation: {},
        materialMemory: {},
        attentionSessions: {},
        diagnosticLog: {},
        readwiseToken: {},
      },
      'local',
    ),
  ).toEqual(['personalProfile', 'attentionScenario', 'savedMaterials']);
  expect(changedInputKeys({ personalProfile: {} }, 'session')).toEqual([]);
});
