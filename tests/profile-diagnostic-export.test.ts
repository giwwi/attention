import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticProfileExport,
  toPortableProfile,
} from '../src/profile/diagnostic-export';
import { createEmptyProfile } from '../src/profile/schema';
import { createDefaultScenarioState } from '../src/scenario/scenario';

describe('diagnostic profile export', () => {
  it('keeps profile signals while removing internal ids and attributions', () => {
    const profile = createEmptyProfile(new Date('2026-08-28T08:00:00.000Z'));
    profile.interests.push({
      id: 'private-internal-id',
      topic: 'AI evaluation',
      strength: 0.9,
      confidence: 0.8,
      sources: [
        {
          source: 'chatgpt',
          importedAt: '2026-08-28T08:00:00.000Z',
          generatedAt: null,
        },
      ],
    });

    const portable = toPortableProfile(profile);
    expect(portable?.interests).toEqual([
      { topic: 'AI evaluation', strength: 0.9, confidence: 0.8 },
    ]);
    expect(JSON.stringify(portable)).not.toContain('private-internal-id');
    expect(JSON.stringify(portable)).not.toContain('sources');
  });

  it('exports only aggregate evidence and never raw browsing or note data', () => {
    const profile = createEmptyProfile(new Date('2026-08-28T08:00:00.000Z'));
    profile.goals.push({
      id: 'goal-1',
      goal: 'Improve article evaluation',
      priority: 'high',
      status: 'active',
      confidence: 0.9,
      sources: [],
    });
    const snapshot = buildDiagnosticProfileExport(
      {
        profile,
        scenario: createDefaultScenarioState(
          new Date('2026-08-28T08:00:00.000Z'),
        ),
        historyEvidence: {
          schemaVersion: 1,
          generatedAt: '2026-08-28T08:00:00.000Z',
          periodStart: '2026-07-29T08:00:00.000Z',
          periodEnd: '2026-08-28T08:00:00.000Z',
          processedUrlCount: 25,
          totalVisitCount: 40,
          excludedUrlCount: 5,
          pages: [
            {
              fingerprint: 'private-page-fingerprint',
              visitCount: 3,
              typedCount: 0,
              lastEncounteredAt: '2026-08-28T07:00:00.000Z',
              confidence: 0.7,
            },
          ],
          topics: [
            {
              topic: 'machine learning',
              pageCount: 4,
              visitCount: 7,
              sourceCount: 2,
              lastEncounteredAt: '2026-08-28T07:00:00.000Z',
              confidence: 0.8,
            },
          ],
          sources: [
            {
              hostname: 'example.com',
              pageCount: 4,
              visitCount: 7,
              typedCount: 1,
              lastEncounteredAt: '2026-08-28T07:00:00.000Z',
              confidence: 0.8,
            },
          ],
        },
        historySettings: {
          lookbackDays: 30,
          lastProcessedAt: '2026-08-28T08:00:00.000Z',
          processedUrlCount: 25,
          totalVisitCount: 40,
          excludedUrlCount: 5,
          permissionRetained: false,
        },
        readwise: {
          connected: true,
          lastSyncedAt: '2026-08-28T08:00:00.000Z',
          evidenceUpdatedAt: '2026-08-28T08:00:00.000Z',
          sourceCount: 8,
          highlightCount: 40,
          noteCount: 4,
          excludedSourceCount: 1,
        },
        obsidian: {
          connected: true,
          vaultName: 'Private vault name',
          lastIndexedAt: '2026-08-28T08:00:00.000Z',
          evidenceUpdatedAt: '2026-08-28T08:00:00.000Z',
          noteCount: 15,
          fragmentCount: 50,
          skippedFileCount: 2,
        },
        notion: {
          connected: true,
          workspaceName: 'Private workspace name',
          workspaceId: 'private-workspace-id',
          sourceMode: 'mixed',
          lastSyncedAt: '2026-08-28T08:00:00.000Z',
          evidenceUpdatedAt: '2026-08-28T08:00:00.000Z',
          pageCount: 10,
          fragmentCount: 30,
          excludedPageCount: 2,
        },
        noveltyFeedback: [
          {
            id: 'feedback-1',
            url: 'https://private.example/article?token=secret-token',
            title: 'Private article title',
            claim: 'Raw private claim',
            excerpt: 'Raw private excerpt',
            value: 'new',
            createdAt: '2026-08-28T08:00:00.000Z',
          },
        ],
        utilityCalibration: null,
      },
      new Date('2026-08-28T09:00:00.000Z'),
    );

    const serialized = JSON.stringify(snapshot);
    expect(snapshot.profile?.goals[0]?.goal).toBe('Improve article evaluation');
    expect(snapshot.evidence.browserHistory?.topics[0]?.topic).toBe(
      'machine learning',
    );
    expect(snapshot.feedback.novelty).toMatchObject({
      total: 1,
      markedNew: 1,
      markedKnown: 0,
    });
    expect(serialized).not.toContain('private-page-fingerprint');
    expect(serialized).not.toContain('Private vault name');
    expect(serialized).not.toContain('Private workspace name');
    expect(serialized).not.toContain('private-workspace-id');
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('Raw private claim');
    expect(serialized).not.toContain('Raw private excerpt');
    expect(serialized).not.toContain('Private article title');
  });
});
