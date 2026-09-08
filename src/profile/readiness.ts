import type { PersonalProfile } from './schema';

/** A completion flag, an empty import or format preferences alone are not a profile. */
export function isProfileReady(profile: PersonalProfile | null): boolean {
  if (!profile) return false;
  const text = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0;
  return (
    profile.interests.some((item) => text(item?.topic)) ||
    profile.goals.some((item) => text(item?.goal)) ||
    profile.expertise.some((item) => text(item?.topic)) ||
    profile.demonstratedKnowledge.some(
      (item) => text(item?.topic) && text(item?.statement),
    ) ||
    profile.learningAreas.some((item) => text(item?.topic)) ||
    profile.lowValueTopics.some((item) => text(item?.topic)) ||
    profile.leisureProfile.preferences.some((item) => text(item?.category))
  );
}
