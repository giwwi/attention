import {
  PROFILE_SCHEMA_VERSION,
  type ContentPreferences,
  type DemonstratedKnowledge,
  type Expertise,
  type Goal,
  type Interest,
  type LearningArea,
  type LeisurePreference,
  type LowValueTopic,
  type PersonalProfile,
  type PortableProfile,
  type ProfileUncertainty,
  type ProfileCollection,
  type ProfileSource,
  type SourceAttribution,
} from './schema';

export function normalizeKey(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function entryId(kind: string, label: string): string {
  let hash = 2166136261;
  for (const char of `${kind}:${normalizeKey(label)}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${kind}-${(hash >>> 0).toString(36)}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizePortableProfile(
  portable: PortableProfile,
  source: ProfileSource,
  now = new Date(),
): PersonalProfile {
  const importedAt = now.toISOString();
  const attribution: SourceAttribution = {
    source,
    importedAt,
    generatedAt: portable.generatedAt,
  };

  const interestMap = new Map<string, Interest>();
  for (const item of portable.interests) {
    const key = normalizeKey(item.topic);
    const current = interestMap.get(key);
    if (!current) {
      interestMap.set(key, {
        id: entryId('interest', item.topic),
        topic: item.topic.trim().replace(/\s+/g, ' '),
        strength: roundConfidence(item.strength),
        confidence: roundConfidence(item.confidence),
        sources: [attribution],
      });
    } else {
      current.strength = Math.max(
        current.strength,
        roundConfidence(item.strength),
      );
      current.confidence = Math.max(
        current.confidence,
        roundConfidence(item.confidence),
      );
    }
  }

  const goalMap = new Map<string, Goal>();
  for (const item of portable.goals) {
    const key = normalizeKey(item.goal);
    const current = goalMap.get(key);
    if (!current || item.confidence > current.confidence) {
      goalMap.set(key, {
        id: entryId('goal', item.goal),
        goal: item.goal.trim().replace(/\s+/g, ' '),
        priority: item.priority,
        status: item.status,
        confidence: roundConfidence(item.confidence),
        sources: [attribution],
      });
    }
  }

  const expertiseMap = new Map<string, Expertise>();
  for (const item of portable.expertise) {
    const key = normalizeKey(item.topic);
    const current = expertiseMap.get(key);
    if (!current || item.confidence > current.confidence) {
      expertiseMap.set(key, {
        id: entryId('expertise', item.topic),
        topic: item.topic.trim().replace(/\s+/g, ' '),
        level: item.level,
        confidence: roundConfidence(item.confidence),
        basis: uniqueStrings(item.basis),
        sources: [attribution],
      });
    } else {
      current.basis = uniqueStrings([...current.basis, ...item.basis]);
    }
  }

  const lowValueMap = new Map<string, LowValueTopic>();
  for (const item of portable.lowValueTopics) {
    const key = normalizeKey(item.topic);
    const current = lowValueMap.get(key);
    if (!current) {
      lowValueMap.set(key, {
        id: entryId('low-value', item.topic),
        topic: item.topic.trim().replace(/\s+/g, ' '),
        confidence: roundConfidence(item.confidence),
        sources: [attribution],
      });
    } else {
      current.confidence = Math.max(
        current.confidence,
        roundConfidence(item.confidence),
      );
    }
  }

  const knowledgeMap = new Map<string, DemonstratedKnowledge>();
  for (const item of portable.demonstratedKnowledge) {
    const key = normalizeKey(`${item.topic}:${item.statement}`);
    const current = knowledgeMap.get(key);
    if (!current || item.confidence > current.confidence) {
      knowledgeMap.set(key, {
        id: entryId('knowledge', `${item.topic}:${item.statement}`),
        topic: item.topic.trim().replace(/\s+/g, ' '),
        statement: item.statement.trim().replace(/\s+/g, ' '),
        evidenceType: item.evidenceType,
        confidence: roundConfidence(item.confidence),
        basis: uniqueStrings(item.basis),
        sources: [attribution],
      });
    } else {
      current.basis = uniqueStrings([...current.basis, ...item.basis]);
    }
  }

  const learningMap = new Map<string, LearningArea>();
  for (const item of portable.learningAreas) {
    const key = normalizeKey(`${item.topic}:${item.focus ?? ''}`);
    const current = learningMap.get(key);
    if (!current) {
      learningMap.set(key, {
        id: entryId('learning', `${item.topic}:${item.focus ?? ''}`),
        topic: item.topic.trim().replace(/\s+/g, ' '),
        focus: item.focus?.trim().replace(/\s+/g, ' ') ?? null,
        confidence: roundConfidence(item.confidence),
        sources: [attribution],
      });
    } else {
      current.confidence = Math.max(
        current.confidence,
        roundConfidence(item.confidence),
      );
    }
  }

  const uncertaintyMap = new Map<string, ProfileUncertainty>();
  for (const item of portable.uncertainties) {
    const key = normalizeKey(`${item.topic}:${item.note}`);
    const current = uncertaintyMap.get(key);
    if (!current) {
      uncertaintyMap.set(key, {
        id: entryId('uncertainty', `${item.topic}:${item.note}`),
        topic: item.topic.trim().replace(/\s+/g, ' '),
        note: item.note.trim().replace(/\s+/g, ' '),
        confidence: roundConfidence(item.confidence),
        sources: [attribution],
      });
    } else {
      current.confidence = Math.max(
        current.confidence,
        roundConfidence(item.confidence),
      );
    }
  }

  const preferences: ContentPreferences | null = portable.contentPreferences
    ? {
        preferredDepth: portable.contentPreferences.preferredDepth,
        noveltyPreference: portable.contentPreferences.noveltyPreference,
        avoidRepetition: portable.contentPreferences.avoidRepetition,
        preferredFormats: uniqueStrings(
          portable.contentPreferences.preferredFormats.map((item) =>
            item.trim().replace(/\s+/g, ' '),
          ),
        ),
        confidence: roundConfidence(portable.contentPreferences.confidence),
        sources: [attribution],
      }
    : null;

  const leisureMap = new Map<string, LeisurePreference>();
  for (const item of portable.leisureProfile.preferences) {
    const key = normalizeKey(`${item.kind}:${item.category}`);
    const current = leisureMap.get(key);
    if (!current || item.confidence > current.confidence) {
      leisureMap.set(key, {
        id: entryId('leisure', `${item.kind}:${item.category}`),
        kind: item.kind,
        category: item.category.trim().replace(/\s+/g, ' '),
        preference: item.preference,
        confidence: roundConfidence(item.confidence),
        evidenceType: item.evidenceType,
        basis: item.basis.trim().replace(/\s+/g, ' '),
        sources: [attribution],
      });
    }
  }

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    updatedAt: importedAt,
    interests: [...interestMap.values()],
    goals: [...goalMap.values()],
    expertise: [...expertiseMap.values()],
    contentPreferences: preferences,
    lowValueTopics: [...lowValueMap.values()],
    demonstratedKnowledge: [...knowledgeMap.values()],
    learningAreas: [...learningMap.values()],
    leisureProfile: {
      status:
        leisureMap.size > 0 ? 'available' : portable.leisureProfile.status,
      preferences: [...leisureMap.values()],
      noveltyPreference: portable.leisureProfile.noveltyPreference,
      effortPreference: portable.leisureProfile.effortPreference,
      typicalSessionMinutes: portable.leisureProfile.typicalSessionMinutes,
      confidence: roundConfidence(portable.leisureProfile.confidence),
    },
    uncertainties: [...uncertaintyMap.values()],
  };
}

export function removeProfileEntry(
  profile: PersonalProfile,
  collection: ProfileCollection,
  id: string,
): PersonalProfile {
  return {
    ...profile,
    [collection]: profile[collection].filter((item) => item.id !== id),
  };
}

export function createManualEntryId(kind: string): string {
  return `${kind}-manual-${crypto.randomUUID()}`;
}
