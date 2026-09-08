import { expect, type BrowserContext, type Page } from '@playwright/test';
import { normalizePortableProfile } from '../../../src/profile/normalize';
import { validatePortableProfile } from '../../../src/profile/validator';
import { extensionWorker } from './vault';

// Authored fixture for the import UI, not a claim about a real AI response.
export const PROFILE_IMPORT = JSON.stringify({
  schema_version: '2.0',
  leisure_profile: {
    status: 'insufficient_data',
    preferences: [],
    novelty_preference: null,
    effort_preference: null,
    typical_session_minutes: null,
    confidence: 0,
  },
  interests: [
    { topic: 'Software quality and attention', strength: 0.8, confidence: 0.8 },
  ],
  goals: [
    {
      goal: 'Understand practical attention allocation',
      priority: 'high',
      status: 'active',
      confidence: 0.9,
    },
  ],
  expertise: [
    {
      topic: 'Software development',
      level: 'intermediate',
      confidence: 0.8,
      basis: ['Self-reported experience'],
    },
  ],
});

/** Existing-user fixtures opt in explicitly; vault setup alone never creates a profile. */
export async function initializeTestProfile(
  context: BrowserContext,
): Promise<void> {
  const parsed = validatePortableProfile(PROFILE_IMPORT);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const profile = normalizePortableProfile(parsed.value, 'chatgpt');
  const worker = await extensionWorker(context);
  await worker.evaluate(async (personalProfile) => {
    await attentionVault.privateStorage.set({ personalProfile });
  }, profile);
}

export async function importTestProfile(popup: Page): Promise<void> {
  await popup.locator('[data-profile-source="chatgpt"]').click();
  await popup.locator('#profile-import-json').fill(PROFILE_IMPORT);
  await popup.locator('#validate-profile').click();
  await expect(popup.locator('#profile-review-step')).toBeVisible();
  await popup.locator('#save-profile').click();
  await expect(popup.locator('#launcher-home')).toBeVisible();
  await expect(popup.locator('#open-page-card')).toBeEnabled();
}
