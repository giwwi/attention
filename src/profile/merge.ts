import { normalizeKey } from './normalize';
import {
  type ContentPreferences,
  type Expertise,
  type Goal,
  type KnowledgeEvidenceType,
  type PersonalProfile,
  type SourceAttribution,
} from './schema';

export type MergeChoice = 'existing' | 'incoming';

export type ProfileConflict =
  | {
      id: string;
      kind: 'expertise';
      label: string;
      existing: Expertise;
      incoming: Expertise;
    }
  | {
      id: string;
      kind: 'goal';
      label: string;
      existing: Goal;
      incoming: Goal;
    }
  | {
      id: string;
      kind: 'contentPreferences';
      label: string;
      existing: ContentPreferences;
      incoming: ContentPreferences;
    };

export interface MergeResult {
  merged: PersonalProfile;
  conflicts: ProfileConflict[];
}

function uniqueSources(
  existing: SourceAttribution[],
  incoming: SourceAttribution[],
): SourceAttribution[] {
  const result = [...existing];
  for (const source of incoming) {
    if (
      !result.some(
        (item) =>
          item.source === source.source &&
          item.importedAt === source.importedAt,
      )
    ) {
      result.push(source);
    }
  }
  return result;
}

function uniqueText(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map(normalizeKey));
  return [
    ...existing,
    ...incoming.filter((item) => {
      const key = normalizeKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

function preferencesMatch(
  existing: ContentPreferences,
  incoming: ContentPreferences,
): boolean {
  return (
    existing.preferredDepth === incoming.preferredDepth &&
    existing.noveltyPreference === incoming.noveltyPreference &&
    existing.avoidRepetition === incoming.avoidRepetition &&
    normalizeKey(existing.preferredFormats.join('|')) ===
      normalizeKey(incoming.preferredFormats.join('|'))
  );
}

const evidenceRank: Record<KnowledgeEvidenceType, number> = {
  inferred: 1,
  explicitly_stated: 2,
  demonstrated: 3,
};

export function mergeProfiles(
  existing: PersonalProfile,
  incoming: PersonalProfile,
): MergeResult {
  const merged: PersonalProfile = structuredClone(existing);
  const conflicts: ProfileConflict[] = [];
  merged.updatedAt = incoming.updatedAt;

  for (const item of incoming.interests) {
    const match = merged.interests.find(
      (current) => normalizeKey(current.topic) === normalizeKey(item.topic),
    );
    if (!match) {
      merged.interests.push(structuredClone(item));
      continue;
    }
    match.strength = Math.max(match.strength, item.strength);
    match.confidence = Math.max(match.confidence, item.confidence);
    match.sources = uniqueSources(match.sources, item.sources);
  }

  for (const item of incoming.goals) {
    const match = merged.goals.find(
      (current) => normalizeKey(current.goal) === normalizeKey(item.goal),
    );
    if (!match) {
      merged.goals.push(structuredClone(item));
      continue;
    }
    if (match.priority !== item.priority || match.status !== item.status) {
      conflicts.push({
        id: `goal:${match.id}`,
        kind: 'goal',
        label: match.goal,
        existing: structuredClone(match),
        incoming: structuredClone(item),
      });
      continue;
    }
    match.confidence = Math.max(match.confidence, item.confidence);
    match.sources = uniqueSources(match.sources, item.sources);
  }

  for (const item of incoming.expertise) {
    const match = merged.expertise.find(
      (current) => normalizeKey(current.topic) === normalizeKey(item.topic),
    );
    if (!match) {
      merged.expertise.push(structuredClone(item));
      continue;
    }
    if (match.level !== item.level) {
      conflicts.push({
        id: `expertise:${match.id}`,
        kind: 'expertise',
        label: match.topic,
        existing: structuredClone(match),
        incoming: structuredClone(item),
      });
      continue;
    }
    match.confidence = Math.max(match.confidence, item.confidence);
    match.basis = uniqueText(match.basis, item.basis);
    match.sources = uniqueSources(match.sources, item.sources);
  }

  for (const item of incoming.lowValueTopics) {
    const match = merged.lowValueTopics.find(
      (current) => normalizeKey(current.topic) === normalizeKey(item.topic),
    );
    if (!match) {
      merged.lowValueTopics.push(structuredClone(item));
      continue;
    }
    match.confidence = Math.max(match.confidence, item.confidence);
    match.sources = uniqueSources(match.sources, item.sources);
  }

  for (const item of incoming.demonstratedKnowledge) {
    const match = merged.demonstratedKnowledge.find(
      (current) =>
        normalizeKey(current.topic) === normalizeKey(item.topic) &&
        normalizeKey(current.statement) === normalizeKey(item.statement),
    );
    if (!match) {
      merged.demonstratedKnowledge.push(structuredClone(item));
      continue;
    }
    if (evidenceRank[item.evidenceType] > evidenceRank[match.evidenceType]) {
      match.evidenceType = item.evidenceType;
    }
    match.confidence = Math.max(match.confidence, item.confidence);
    match.basis = uniqueText(match.basis, item.basis);
    match.sources = uniqueSources(match.sources, item.sources);
  }

  for (const item of incoming.learningAreas) {
    const match = merged.learningAreas.find(
      (current) =>
        normalizeKey(current.topic) === normalizeKey(item.topic) &&
        normalizeKey(current.focus ?? '') === normalizeKey(item.focus ?? ''),
    );
    if (!match) {
      merged.learningAreas.push(structuredClone(item));
      continue;
    }
    match.confidence = Math.max(match.confidence, item.confidence);
    match.sources = uniqueSources(match.sources, item.sources);
  }

  for (const item of incoming.uncertainties) {
    const match = merged.uncertainties.find(
      (current) =>
        normalizeKey(current.topic) === normalizeKey(item.topic) &&
        normalizeKey(current.note) === normalizeKey(item.note),
    );
    if (!match) {
      merged.uncertainties.push(structuredClone(item));
      continue;
    }
    match.confidence = Math.max(match.confidence, item.confidence);
    match.sources = uniqueSources(match.sources, item.sources);
  }

  for (const item of incoming.leisureProfile.preferences) {
    const match = merged.leisureProfile.preferences.find(
      (current) =>
        current.kind === item.kind &&
        normalizeKey(current.category) === normalizeKey(item.category),
    );
    if (!match) {
      merged.leisureProfile.preferences.push(structuredClone(item));
      continue;
    }
    if (item.confidence > match.confidence) {
      match.preference = item.preference;
      match.evidenceType = item.evidenceType;
      match.basis = item.basis;
    }
    match.confidence = Math.max(match.confidence, item.confidence);
    match.sources = uniqueSources(match.sources, item.sources);
  }
  if (
    merged.leisureProfile.status === 'insufficient_data' &&
    incoming.leisureProfile.status === 'available'
  ) {
    merged.leisureProfile.status = 'available';
  }
  if (incoming.leisureProfile.confidence > merged.leisureProfile.confidence) {
    merged.leisureProfile.noveltyPreference =
      incoming.leisureProfile.noveltyPreference;
    merged.leisureProfile.effortPreference =
      incoming.leisureProfile.effortPreference;
    merged.leisureProfile.typicalSessionMinutes =
      incoming.leisureProfile.typicalSessionMinutes;
    merged.leisureProfile.confidence = incoming.leisureProfile.confidence;
  }

  if (!merged.contentPreferences && incoming.contentPreferences) {
    merged.contentPreferences = structuredClone(incoming.contentPreferences);
  } else if (merged.contentPreferences && incoming.contentPreferences) {
    if (
      preferencesMatch(merged.contentPreferences, incoming.contentPreferences)
    ) {
      merged.contentPreferences.confidence = Math.max(
        merged.contentPreferences.confidence,
        incoming.contentPreferences.confidence,
      );
      merged.contentPreferences.sources = uniqueSources(
        merged.contentPreferences.sources,
        incoming.contentPreferences.sources,
      );
    } else {
      conflicts.push({
        id: 'content-preferences',
        kind: 'contentPreferences',
        label: 'Предпочтения по материалам',
        existing: structuredClone(merged.contentPreferences),
        incoming: structuredClone(incoming.contentPreferences),
      });
    }
  }

  return { merged, conflicts };
}

export function resolveMerge(
  result: MergeResult,
  resolutions: Readonly<Record<string, MergeChoice>>,
): PersonalProfile {
  const profile = structuredClone(result.merged);
  for (const conflict of result.conflicts) {
    if (resolutions[conflict.id] !== 'incoming') continue;
    if (conflict.kind === 'contentPreferences') {
      profile.contentPreferences = structuredClone(conflict.incoming);
      continue;
    }
    const collection =
      conflict.kind === 'goal' ? profile.goals : profile.expertise;
    const index = collection.findIndex(
      (item) => item.id === conflict.existing.id,
    );
    if (index >= 0) {
      // The two branches have different item shapes, but both preserve their own
      // collection type and are narrowed by `conflict.kind` above.
      if (conflict.kind === 'goal') {
        profile.goals[index] = structuredClone(conflict.incoming);
      } else {
        profile.expertise[index] = structuredClone(conflict.incoming);
      }
    }
  }
  return profile;
}
