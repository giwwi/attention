import { createManualEntryId } from '../profile/normalize';
import type { PersonalProfile, SourceAttribution } from '../profile/schema';

export type ProfileQuestion = 'goal' | 'interests' | 'knowledge';
const hasText = (value: string): boolean => value.trim().length > 0;

/** Completeness for a new setup, not a quality score or a migration of existing profiles. */
export function nextProfileQuestion(
  profile: PersonalProfile,
): ProfileQuestion | null {
  if (
    !profile.goals.some(
      (item) => item.status === 'active' && hasText(item.goal),
    )
  )
    return 'goal';
  if (
    !profile.interests.some((item) => hasText(item.topic)) &&
    !profile.leisureProfile.preferences.some(
      (item) => item.kind !== 'dislike' && hasText(item.category),
    )
  )
    return 'interests';
  if (
    !profile.expertise.some((item) => hasText(item.topic)) &&
    !profile.demonstratedKnowledge.some(
      (item) => hasText(item.topic) && hasText(item.statement),
    ) &&
    !profile.learningAreas.some((item) => hasText(item.topic))
  )
    return 'knowledge';
  return null;
}

/** These are explicit answers. Do not infer expertise or knowledge from an interest. */
export function addProfileAnswer(
  profile: PersonalProfile,
  question: ProfileQuestion,
  answer: string,
  options: { topic?: string; beginner?: boolean } = {},
): void {
  const sources: SourceAttribution[] = [
    {
      source: 'manual',
      importedAt: new Date().toISOString(),
      generatedAt: null,
    },
  ];
  const value = answer.trim();
  if (question === 'goal' && value)
    profile.goals.push({
      id: createManualEntryId('goal'),
      goal: value,
      priority: 'high',
      status: 'active',
      confidence: 1,
      sources,
    });
  if (question === 'interests')
    for (const topic of [
      ...new Set(
        value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ]) {
      profile.interests.push({
        id: createManualEntryId('interest'),
        topic,
        strength: 1,
        confidence: 1,
        sources,
      });
    }
  if (question !== 'knowledge') return;
  if (options.beginner) {
    const topics = [
      ...profile.interests.map((item) => item.topic),
      ...profile.leisureProfile.preferences
        .filter((item) => item.kind !== 'dislike')
        .map((item) => item.category),
    ];
    for (const topic of [...new Set(topics.filter(hasText))]) {
      if (!profile.learningAreas.some((item) => item.topic === topic))
        profile.learningAreas.push({
          id: createManualEntryId('learning'),
          topic,
          focus: null,
          confidence: 1,
          sources,
        });
    }
  } else if (value && options.topic?.trim())
    profile.demonstratedKnowledge.push({
      id: createManualEntryId('knowledge'),
      topic: options.topic.trim(),
      statement: value,
      evidenceType: 'explicitly_stated',
      confidence: 1,
      basis: [],
      sources,
    });
}
