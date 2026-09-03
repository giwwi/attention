import type { ScrollDepth } from '../shared/types';

export function readingEngagementThreshold(
  estimatedReadingSeconds: number,
): number {
  // Reaching the end of the article is the stronger signal. Time remains a
  // guard against drive-by scrolling, but waiting for 30% of a long estimate
  // made the prompt appear several minutes after the user had actually
  // finished. Keep the gate proportional, with practical MVP bounds.
  return Math.max(30, Math.min(120, estimatedReadingSeconds * 0.15));
}

export function hasMeaningfulReadingEngagement(
  visibleSeconds: number,
  maxScrollDepth: ScrollDepth,
  estimatedReadingSeconds: number,
): boolean {
  return (
    visibleSeconds >= readingEngagementThreshold(estimatedReadingSeconds) &&
    maxScrollDepth >= 75
  );
}
