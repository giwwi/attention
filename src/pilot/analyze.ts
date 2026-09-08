import { LocalAnalyzer } from '../analyzer/local-analyzer';
import { selectRelevantPersonalContext } from '../history/relevance';
import { loadBrowserHistoryEvidence } from '../history/storage';
import { loadReadwiseEvidence } from '../readwise/storage';
import { loadObsidianEvidence } from '../obsidian/evidence';
import { loadNotionEvidence } from '../notion/evidence';
import { loadProfile } from '../profile/storage';
import { loadNovelPassageFeedback } from '../novelty/feedback';
import { loadUtilityCalibration } from '../utility/storage';
import { calibrateMaterialEvaluation } from '../utility/calibration';
import type { AnalysisContext, PageCapture } from '../shared/types';

/** Read-only local pipeline. Pilot labels never enter profile or calibration. */
export async function analyzePilotArticle(
  capture: PageCapture,
  intent: string,
  usePersonalContext: boolean,
) {
  const context: AnalysisContext = {
    scenario: 'work',
    availableMinutes: 15,
    intent,
  };
  const [profile, history, readwise, obsidian, notion, claims, calibration] =
    usePersonalContext
      ? await Promise.all([
          loadProfile(),
          loadBrowserHistoryEvidence(),
          loadReadwiseEvidence(),
          loadObsidianEvidence(),
          loadNotionEvidence(),
          loadNovelPassageFeedback(),
          loadUtilityCalibration(),
        ])
      : ([null, null, null, null, null, [], null] as const);
  const relevant = usePersonalContext
    ? await selectRelevantPersonalContext(
        profile,
        history,
        readwise,
        obsidian,
        notion,
        capture,
        context,
        [...claims],
      )
    : null;
  const raw = await new LocalAnalyzer().analyze(capture, context, relevant);
  return calibrateMaterialEvaluation(
    raw,
    capture.readingTimeMinutes,
    calibration,
  );
}
