/**
 * Headlines Storage
 *
 * Simple file-based storage for headlines runs.
 * Uses the /tmp directory for Vercel serverless compatibility.
 *
 * In production, this could be replaced with:
 * - Vercel KV (Redis)
 * - Vercel Postgres
 * - Upstash Redis
 */

import { HeadlinesRun, Headline } from './types';

// In-memory cache of the latest run (for fast reads)
let latestRun: HeadlinesRun | null = null;

// Keep history of last 24 runs (6 hours worth at 15-min intervals)
const runHistory: HeadlinesRun[] = [];
const MAX_HISTORY = 24;

/**
 * Store a new headlines run
 */
export function storeHeadlinesRun(headlines: Headline[], factsSummary?: string): HeadlinesRun {
  const run: HeadlinesRun = {
    id: generateRunId(),
    timestamp: new Date().toISOString(),
    headlines,
    facts_summary: factsSummary,
  };

  // Update latest
  latestRun = run;

  // Add to history
  runHistory.unshift(run);
  if (runHistory.length > MAX_HISTORY) {
    runHistory.pop();
  }

  return run;
}

/**
 * Get the latest headlines run
 */
export function getLatestRun(): HeadlinesRun | null {
  return latestRun;
}

/**
 * Get headlines run history
 */
export function getRunHistory(): HeadlinesRun[] {
  return [...runHistory];
}

/**
 * Get a specific run by ID
 */
export function getRunById(id: string): HeadlinesRun | null {
  if (latestRun?.id === id) return latestRun;
  return runHistory.find(r => r.id === id) || null;
}

/**
 * Check if we need a new run (15 minute intervals)
 */
export function needsNewRun(): boolean {
  if (!latestRun) return true;

  const lastRunTime = new Date(latestRun.timestamp).getTime();
  const now = Date.now();
  const fifteenMinutes = 15 * 60 * 1000;

  return now - lastRunTime >= fifteenMinutes;
}

/**
 * Generate a unique run ID
 */
function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `run_${timestamp}_${random}`;
}

/**
 * Initialize with seed data if needed (for development)
 */
export function initializeWithSeedData(): void {
  if (latestRun) return;

  const now = new Date().toISOString();

  // Create placeholder data for initial load
  const seedHeadlines: Headline[] = [
    {
      id: 'seed1',
      headline: 'Headlines updating - refresh in a moment',
      topic: 'general',
      confidence_label: 'Low',
      location: { state: 'United States', place: 'Nationwide' },
      timestamp_utc: now,
      source_name: 'System',
      source_url: 'https://www.weather.gov/',
      fact_ids: [],
    },
  ];

  // Fill to 10
  while (seedHeadlines.length < 10) {
    seedHeadlines.push({
      id: `seed${seedHeadlines.length + 1}`,
      headline: 'Loading latest weather data...',
      topic: 'general',
      confidence_label: 'Low',
      location: { state: 'United States', place: 'Nationwide' },
      timestamp_utc: now,
      source_name: 'System',
      source_url: 'https://www.weather.gov/',
      fact_ids: [],
    });
  }

  latestRun = {
    id: 'seed_initial',
    timestamp: now,
    headlines: seedHeadlines,
    facts_summary: 'Initial seed data - waiting for first update',
  };
}

/**
 * Clear all stored data (for testing)
 */
export function clearStorage(): void {
  latestRun = null;
  runHistory.length = 0;
}
