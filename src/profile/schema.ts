import type { CognitiveEffort } from '../shared/types';

export const PROFILE_SCHEMA_VERSION = '2.0' as const;
export const LEGACY_PROFILE_SCHEMA_VERSION = '1.0' as const;

export type ExternalProfileSource = 'chatgpt' | 'claude' | 'other';
export type ProfileSource = ExternalProfileSource | 'manual' | 'quick_ai';
export type GoalPriority = 'low' | 'medium' | 'high';
export type GoalStatus = 'active' | 'paused' | 'completed';
export type ExpertiseLevel =
  'beginner' | 'intermediate' | 'advanced' | 'expert';
export type PreferenceLevel = 'low' | 'medium' | 'high';
export type KnowledgeEvidenceType =
  'demonstrated' | 'explicitly_stated' | 'inferred';
export type LeisureProfileStatus = 'available' | 'insufficient_data';
export type LeisurePreferenceKind =
  'genre' | 'format' | 'creator' | 'recreationalTopic' | 'dislike';
export type LeisurePreferenceLevel = PreferenceLevel | 'unknown';
export type LeisureNoveltyPreference = 'familiar' | 'balanced' | 'novel';

export interface SourceAttribution {
  source: ProfileSource;
  importedAt: string;
  generatedAt: string | null;
}

export interface Interest {
  id: string;
  topic: string;
  strength: number;
  confidence: number;
  sources: SourceAttribution[];
}

export interface Goal {
  id: string;
  goal: string;
  priority: GoalPriority;
  status: GoalStatus;
  confidence: number;
  sources: SourceAttribution[];
}

export interface Expertise {
  id: string;
  topic: string;
  level: ExpertiseLevel;
  confidence: number;
  basis: string[];
  sources: SourceAttribution[];
}

export interface ContentPreferences {
  preferredDepth: PreferenceLevel;
  noveltyPreference: PreferenceLevel;
  avoidRepetition: boolean;
  preferredFormats: string[];
  confidence: number;
  sources: SourceAttribution[];
}

export interface LowValueTopic {
  id: string;
  topic: string;
  confidence: number;
  sources: SourceAttribution[];
}

export interface DemonstratedKnowledge {
  id: string;
  topic: string;
  statement: string;
  evidenceType: KnowledgeEvidenceType;
  confidence: number;
  basis: string[];
  sources: SourceAttribution[];
}

export interface LearningArea {
  id: string;
  topic: string;
  focus: string | null;
  confidence: number;
  sources: SourceAttribution[];
}

export interface ProfileUncertainty {
  id: string;
  topic: string;
  note: string;
  confidence: number;
  sources: SourceAttribution[];
}

export interface LeisurePreference {
  id: string;
  kind: LeisurePreferenceKind;
  category: string;
  preference: LeisurePreferenceLevel;
  confidence: number;
  evidenceType: KnowledgeEvidenceType;
  basis: string;
  sources: SourceAttribution[];
}

export interface LeisureProfile {
  status: LeisureProfileStatus;
  preferences: LeisurePreference[];
  noveltyPreference: LeisureNoveltyPreference | null;
  effortPreference: CognitiveEffort | null;
  typicalSessionMinutes: number | null;
  confidence: number;
}

export interface PersonalProfile {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  updatedAt: string;
  interests: Interest[];
  goals: Goal[];
  expertise: Expertise[];
  contentPreferences: ContentPreferences | null;
  lowValueTopics: LowValueTopic[];
  demonstratedKnowledge: DemonstratedKnowledge[];
  learningAreas: LearningArea[];
  leisureProfile: LeisureProfile;
  uncertainties: ProfileUncertainty[];
}

export interface PortableInterest {
  topic: string;
  strength: number;
  confidence: number;
}

export interface PortableGoal {
  goal: string;
  priority: GoalPriority;
  status: GoalStatus;
  confidence: number;
}

export interface PortableExpertise {
  topic: string;
  level: ExpertiseLevel;
  confidence: number;
  basis: string[];
}

export interface PortableContentPreferences {
  preferredDepth: PreferenceLevel;
  noveltyPreference: PreferenceLevel;
  avoidRepetition: boolean;
  preferredFormats: string[];
  confidence: number;
}

export interface PortableLowValueTopic {
  topic: string;
  confidence: number;
}

export interface PortableDemonstratedKnowledge {
  topic: string;
  statement: string;
  evidenceType: KnowledgeEvidenceType;
  confidence: number;
  basis: string[];
}

export interface PortableLearningArea {
  topic: string;
  focus: string | null;
  confidence: number;
}

export interface PortableProfileUncertainty {
  topic: string;
  note: string;
  confidence: number;
}

export interface PortableLeisurePreference {
  kind: LeisurePreferenceKind;
  category: string;
  preference: LeisurePreferenceLevel;
  confidence: number;
  evidenceType: KnowledgeEvidenceType;
  basis: string;
}

export interface PortableLeisureProfile {
  status: LeisureProfileStatus;
  preferences: PortableLeisurePreference[];
  noveltyPreference: LeisureNoveltyPreference | null;
  effortPreference: CognitiveEffort | null;
  typicalSessionMinutes: number | null;
  confidence: number;
}

export interface PortableProfile {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  generatedAt: string | null;
  interests: PortableInterest[];
  goals: PortableGoal[];
  expertise: PortableExpertise[];
  contentPreferences: PortableContentPreferences | null;
  lowValueTopics: PortableLowValueTopic[];
  demonstratedKnowledge: PortableDemonstratedKnowledge[];
  learningAreas: PortableLearningArea[];
  leisureProfile: PortableLeisureProfile;
  uncertainties: PortableProfileUncertainty[];
}

export type ProfileCollection =
  | 'interests'
  | 'goals'
  | 'expertise'
  | 'lowValueTopics'
  | 'demonstratedKnowledge'
  | 'learningAreas'
  | 'uncertainties';

export function createEmptyProfile(now = new Date()): PersonalProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    interests: [],
    goals: [],
    expertise: [],
    contentPreferences: null,
    lowValueTopics: [],
    demonstratedKnowledge: [],
    learningAreas: [],
    leisureProfile: {
      status: 'insufficient_data',
      preferences: [],
      noveltyPreference: null,
      effortPreference: null,
      typicalSessionMinutes: null,
      confidence: 0,
    },
    uncertainties: [],
  };
}

export function hasProfileContent(profile: PersonalProfile): boolean {
  return (
    profile.interests.length > 0 ||
    profile.goals.length > 0 ||
    profile.expertise.length > 0 ||
    profile.lowValueTopics.length > 0 ||
    profile.demonstratedKnowledge.length > 0 ||
    profile.learningAreas.length > 0 ||
    profile.leisureProfile.preferences.length > 0 ||
    profile.uncertainties.length > 0 ||
    profile.contentPreferences !== null
  );
}
