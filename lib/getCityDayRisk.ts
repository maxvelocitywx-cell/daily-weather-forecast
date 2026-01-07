/**
 * Get canonical city risk score for a specific day
 *
 * Single source of truth for city/day risk lookups.
 * Returns null if data is missing - callers must handle null appropriately.
 */

import { CityMetricsSummary } from './types';

export interface CityDayRiskResult {
  /** The canonical risk score, or null if missing */
  score: number | null;
  /** Whether data was found */
  hasData: boolean;
}

/**
 * Get the canonical risk score for a city on a specific day
 *
 * @param city - The city data from useRegionCities
 * @param dayIndex - 0-based day index (selectedDay - 1)
 * @returns Risk result with score (null if missing) and hasData flag
 */
export function getCityDayRisk(
  city: CityMetricsSummary | null | undefined,
  dayIndex: number
): CityDayRiskResult {
  if (!city) {
    return { score: null, hasData: false };
  }

  // Primary source: city.days[dayIndex].risk
  const dayData = city.days?.[dayIndex];
  if (dayData && typeof dayData.risk === 'number' && !isNaN(dayData.risk)) {
    return { score: dayData.risk, hasData: true };
  }

  // Fallback: city.dailyRisks[dayIndex].score_display
  const dailyRisk = city.dailyRisks?.[dayIndex];
  if (dailyRisk && typeof dailyRisk.score_display === 'number' && !isNaN(dailyRisk.score_display)) {
    return { score: dailyRisk.score_display, hasData: true };
  }

  // No data found
  return { score: null, hasData: false };
}

/**
 * Format risk score for display
 * Returns "N/A" for missing data, otherwise formatted number
 */
export function formatRiskScore(score: number | null): string {
  if (score === null) {
    return 'N/A';
  }
  return score.toFixed(1);
}

/**
 * Comparator for sorting cities by risk
 * Missing scores are pushed to the bottom regardless of sort direction
 *
 * @param direction - 'asc' or 'desc'
 * @returns Comparator function for Array.sort()
 */
export function createRiskComparator(
  direction: 'asc' | 'desc',
  dayIndex: number
): (a: CityMetricsSummary, b: CityMetricsSummary) => number {
  return (a, b) => {
    const aResult = getCityDayRisk(a, dayIndex);
    const bResult = getCityDayRisk(b, dayIndex);

    // Missing scores go to bottom
    if (!aResult.hasData && !bResult.hasData) return 0;
    if (!aResult.hasData) return 1; // a goes to bottom
    if (!bResult.hasData) return -1; // b goes to bottom

    const aScore = aResult.score!;
    const bScore = bResult.score!;

    return direction === 'desc' ? bScore - aScore : aScore - bScore;
  };
}
