/**
 * Xweather Headlines Storage
 *
 * In-memory storage with file persistence for headline runs.
 * Stores the latest run and recent history.
 */

import { XweatherHeadline, HeadlinesRun } from './types';

// ============================================================================
// STORAGE
// ============================================================================

// In-memory storage
let latestRun: HeadlinesRun | null = null;
const runHistory: HeadlinesRun[] = [];
const MAX_HISTORY = 10;

// Freshness threshold (15 minutes)
const FRESHNESS_TTL = 15 * 60 * 1000;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Store a new headlines run
 */
export function storeHeadlinesRun(
  headlines: XweatherHeadline[],
  factsSummary: string
): HeadlinesRun {
  const run: HeadlinesRun = {
    id: generateRunId(),
    timestamp: new Date().toISOString(),
    headlines,
    facts_summary: factsSummary,
    validation: {
      facts_used: headlines.reduce((sum, h) => sum + h.fact_ids.length, 0),
      headlines_validated: headlines.every(h => h.fact_ids.length > 0),
    },
  };

  // Update latest
  latestRun = run;

  // Add to history
  runHistory.unshift(run);
  if (runHistory.length > MAX_HISTORY) {
    runHistory.pop();
  }

  console.log(`[Xweather Storage] Stored run ${run.id} with ${headlines.length} headlines`);

  return run;
}

/**
 * Get the latest headlines run
 */
export function getLatestRun(): HeadlinesRun | null {
  return latestRun;
}

/**
 * Get run history
 */
export function getRunHistory(): HeadlinesRun[] {
  return [...runHistory];
}

/**
 * Check if we need a new run (current run is stale)
 */
export function needsNewRun(): boolean {
  if (!latestRun) return true;

  const runTime = new Date(latestRun.timestamp).getTime();
  const age = Date.now() - runTime;

  return age > FRESHNESS_TTL;
}

/**
 * Get time until next required run
 */
export function getTimeUntilNextRun(): number {
  if (!latestRun) return 0;

  const runTime = new Date(latestRun.timestamp).getTime();
  const age = Date.now() - runTime;
  const remaining = FRESHNESS_TTL - age;

  return Math.max(0, remaining);
}

/**
 * Clear all stored runs
 */
export function clearStorage(): void {
  latestRun = null;
  runHistory.length = 0;
}

// ============================================================================
// HELPERS
// ============================================================================

function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `xw-${timestamp}-${random}`;
}

// ============================================================================
// PLACEHOLDER HEADLINES
// ============================================================================

/**
 * Generate placeholder headlines when no data is available
 */
export function generatePlaceholderHeadlines(): XweatherHeadline[] {
  return [
    {
      headline: 'Check Xweather for active weather alerts across the United States',
      topic: 'general',
      confidence_label: 'Forecast',
      regions: ['United States'],
      fact_ids: [],
      source_url: 'https://www.xweather.com/alerts',
    },
    {
      headline: 'Storm reports being monitored across the central United States',
      topic: 'severe',
      confidence_label: 'Reported',
      regions: ['Central Plains'],
      fact_ids: [],
      source_url: 'https://www.xweather.com/stormreports',
    },
    {
      headline: 'Real-time observations updating from weather stations nationwide',
      topic: 'general',
      confidence_label: 'Measured',
      regions: ['United States'],
      fact_ids: [],
      source_url: 'https://www.xweather.com/observations',
    },
    {
      headline: 'Winter weather being tracked across northern tier states',
      topic: 'winter',
      confidence_label: 'Forecast',
      regions: ['Northern Plains', 'Upper Midwest'],
      fact_ids: [],
      source_url: 'https://www.xweather.com/alerts',
    },
    {
      headline: 'Flood watches and warnings monitored for affected areas',
      topic: 'flood',
      confidence_label: 'Forecast',
      regions: ['Multiple States'],
      fact_ids: [],
      source_url: 'https://www.xweather.com/alerts',
    },
    {
      headline: 'Fire weather conditions tracked in western United States',
      topic: 'fire',
      confidence_label: 'Forecast',
      regions: ['California', 'Arizona', 'Nevada'],
      fact_ids: [],
      source_url: 'https://www.xweather.com/alerts',
    },
    {
      headline: 'Tropical weather being monitored in Atlantic and Gulf regions',
      topic: 'tropical',
      confidence_label: 'Forecast',
      regions: ['Gulf Coast', 'Atlantic Coast'],
      fact_ids: [],
      source_url: 'https://www.xweather.com/tropical',
    },
    {
      headline: 'Heat advisories tracked across southern states',
      topic: 'heat',
      confidence_label: 'Forecast',
      regions: ['Texas', 'Arizona', 'Florida'],
      fact_ids: [],
      source_url: 'https://www.xweather.com/alerts',
    },
    {
      headline: 'Severe thunderstorm potential monitored for impacted regions',
      topic: 'severe',
      confidence_label: 'Forecast',
      regions: ['Multiple States'],
      fact_ids: [],
      source_url: 'https://www.xweather.com/alerts',
    },
    {
      headline: 'Latest weather updates available via Xweather services',
      topic: 'general',
      confidence_label: 'Forecast',
      regions: ['United States'],
      fact_ids: [],
      source_url: 'https://www.xweather.com',
    },
  ];
}
