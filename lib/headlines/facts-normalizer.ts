/**
 * Facts Normalizer and Deduplicator
 *
 * Normalizes EventFacts from multiple sources and deduplicates
 * based on location, type, magnitude, and time window.
 */

import { EventFact, EventFactType } from './types';

// Deduplication window in milliseconds
const DEDUPE_WINDOW_MS = 45 * 60 * 1000; // 45 minutes

// Location rounding precision (decimal places)
// ~0.01 degrees = ~1.1 km, enough to group nearby reports
const LOCATION_PRECISION = 2;

/**
 * Round a number to specified decimal places
 */
function roundTo(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

/**
 * Create a deduplication key for an EventFact
 *
 * Key format: type|rounded_lat|rounded_lon|magnitude_bucket|time_bucket
 */
function createDedupeKey(fact: EventFact): string {
  const roundedLat = roundTo(fact.lat, LOCATION_PRECISION);
  const roundedLon = roundTo(fact.lon, LOCATION_PRECISION);

  // Bucket magnitude for similar grouping
  let magBucket = 'null';
  if (fact.magnitude !== null) {
    if (typeof fact.magnitude === 'number') {
      // Round to nearest 5 for numbers
      magBucket = String(Math.round(fact.magnitude / 5) * 5);
    } else {
      // Use string as-is for EF ratings, etc.
      magBucket = String(fact.magnitude);
    }
  }

  // Bucket time to DEDUPE_WINDOW_MS intervals
  const timestamp = new Date(fact.timestamp_utc).getTime();
  const timeBucket = Math.floor(timestamp / DEDUPE_WINDOW_MS);

  return `${fact.type}|${roundedLat}|${roundedLon}|${magBucket}|${timeBucket}`;
}

/**
 * Priority score for confidence levels
 * Higher score = more trustworthy source
 */
const CONFIDENCE_PRIORITY: Record<string, number> = {
  measured: 4,
  surveyed: 3,
  reported: 2,
  estimated: 1,
};

/**
 * Priority score for event types (for display ranking)
 * Higher score = more newsworthy
 */
const EVENT_TYPE_PRIORITY: Record<EventFactType, number> = {
  tornado_rating: 100,
  tornado_report: 95,
  wind_gust: 80,
  hail: 75,
  flash_flood: 70,
  flood: 60,
  damage: 55,
  temperature_extreme: 50,
  snowfall: 45,
  ice_accumulation: 40,
  marine_hazard: 30,
  lightning: 20,
  other: 10,
};

/**
 * Calculate an impact score for an EventFact
 */
function calculateImpactScore(fact: EventFact): number {
  let score = EVENT_TYPE_PRIORITY[fact.type] || 10;

  // Add magnitude bonus
  if (fact.magnitude !== null) {
    if (fact.type === 'wind_gust' && typeof fact.magnitude === 'number') {
      // Wind: higher is more impactful
      if (fact.magnitude >= 100) score += 30;
      else if (fact.magnitude >= 80) score += 20;
      else if (fact.magnitude >= 70) score += 10;
    } else if (fact.type === 'hail' && typeof fact.magnitude === 'number') {
      // Hail: larger is more impactful
      if (fact.magnitude >= 2.0) score += 25; // 2"+ is significant
      else if (fact.magnitude >= 1.75) score += 20;
      else if (fact.magnitude >= 1.0) score += 10;
    } else if (fact.type === 'tornado_rating' && typeof fact.magnitude === 'string') {
      // EF rating
      const efNum = parseInt(fact.magnitude.replace(/\D/g, ''), 10);
      if (!isNaN(efNum)) {
        score += efNum * 10; // EF5 = +50
      }
    } else if (fact.type === 'snowfall' && typeof fact.magnitude === 'number') {
      // Snowfall: higher totals are more impactful
      if (fact.magnitude >= 12) score += 20;
      else if (fact.magnitude >= 8) score += 10;
    }
  }

  // Confidence bonus
  score += (CONFIDENCE_PRIORITY[fact.confidence] || 0) * 2;

  return score;
}

/**
 * Deduplicate EventFacts, keeping the best version of each
 */
export function deduplicateFacts(facts: EventFact[]): EventFact[] {
  const groups: Map<string, EventFact[]> = new Map();

  // Group by dedupe key
  for (const fact of facts) {
    const key = createDedupeKey(fact);
    const group = groups.get(key) || [];
    group.push(fact);
    groups.set(key, group);
  }

  // Select best from each group
  const deduplicated: EventFact[] = [];

  for (const [, group] of groups) {
    if (group.length === 1) {
      deduplicated.push(group[0]);
    } else {
      // Sort by confidence priority (measured > surveyed > reported > estimated)
      // Then by timestamp (newer is better)
      group.sort((a, b) => {
        const confDiff = (CONFIDENCE_PRIORITY[b.confidence] || 0) - (CONFIDENCE_PRIORITY[a.confidence] || 0);
        if (confDiff !== 0) return confDiff;

        // Prefer higher magnitude within same confidence
        const magA = typeof a.magnitude === 'number' ? a.magnitude : 0;
        const magB = typeof b.magnitude === 'number' ? b.magnitude : 0;
        if (magA !== magB) return magB - magA;

        // Newer timestamp
        return new Date(b.timestamp_utc).getTime() - new Date(a.timestamp_utc).getTime();
      });

      deduplicated.push(group[0]);
    }
  }

  return deduplicated;
}

/**
 * Sort EventFacts by impact score (most impactful first)
 */
export function sortByImpact(facts: EventFact[]): EventFact[] {
  return [...facts].sort((a, b) => {
    const scoreA = calculateImpactScore(a);
    const scoreB = calculateImpactScore(b);
    if (scoreA !== scoreB) return scoreB - scoreA;

    // Tie-breaker: more recent first
    return new Date(b.timestamp_utc).getTime() - new Date(a.timestamp_utc).getTime();
  });
}

/**
 * Filter to only significant events
 * Returns events that meet minimum thresholds for each type
 */
export function filterSignificant(facts: EventFact[]): EventFact[] {
  return facts.filter(fact => {
    switch (fact.type) {
      case 'tornado_report':
      case 'tornado_rating':
        // All tornado events are significant
        return true;

      case 'wind_gust':
        // >= 70 mph is significant (58 kt = 67 mph is severe threshold)
        if (typeof fact.magnitude === 'number') {
          return fact.magnitude >= 70;
        }
        return false;

      case 'hail':
        // >= 1.00" is significant (quarter size)
        if (typeof fact.magnitude === 'number') {
          return fact.magnitude >= 1.0;
        }
        return false;

      case 'flash_flood':
        // All flash flood reports are significant
        return true;

      case 'flood':
        // All flood reports included
        return true;

      case 'snowfall':
        // >= 6" is significant
        if (typeof fact.magnitude === 'number') {
          return fact.magnitude >= 6;
        }
        return false;

      case 'ice_accumulation':
        // >= 0.25" is significant
        if (typeof fact.magnitude === 'number') {
          return fact.magnitude >= 0.25;
        }
        return true; // Include if no magnitude specified

      case 'temperature_extreme':
        // Include all (already filtered by fetcher)
        return true;

      case 'damage':
        // All damage reports are significant
        return true;

      case 'marine_hazard':
        // Include significant marine events
        return true;

      default:
        return false;
    }
  });
}

/**
 * Process and normalize facts from all sources
 *
 * 1. Combine all facts
 * 2. Filter to significant events
 * 3. Deduplicate
 * 4. Sort by impact
 */
export function processEventFacts(
  lsrFacts: EventFact[],
  stationFacts: EventFact[],
  stormEventsFacts: EventFact[]
): EventFact[] {
  // Combine all sources
  const allFacts = [...lsrFacts, ...stationFacts, ...stormEventsFacts];

  console.log(`[Facts Normalizer] Processing ${allFacts.length} total facts`);
  console.log(`  - LSR: ${lsrFacts.length}`);
  console.log(`  - Station Obs: ${stationFacts.length}`);
  console.log(`  - Storm Events: ${stormEventsFacts.length}`);

  // Filter to significant events
  const significant = filterSignificant(allFacts);
  console.log(`  - Significant: ${significant.length}`);

  // Deduplicate
  const deduplicated = deduplicateFacts(significant);
  console.log(`  - After dedup: ${deduplicated.length}`);

  // Sort by impact
  const sorted = sortByImpact(deduplicated);

  return sorted;
}

/**
 * Get a summary of event facts for logging/display
 */
export function getFactsSummary(facts: EventFact[]): string {
  const typeCounts: Record<string, number> = {};

  for (const fact of facts) {
    typeCounts[fact.type] = (typeCounts[fact.type] || 0) + 1;
  }

  const parts: string[] = [];
  if (typeCounts.tornado_report) parts.push(`${typeCounts.tornado_report} tornado reports`);
  if (typeCounts.tornado_rating) parts.push(`${typeCounts.tornado_rating} EF ratings`);
  if (typeCounts.wind_gust) parts.push(`${typeCounts.wind_gust} wind reports`);
  if (typeCounts.hail) parts.push(`${typeCounts.hail} hail reports`);
  if (typeCounts.flash_flood) parts.push(`${typeCounts.flash_flood} flash flood reports`);
  if (typeCounts.flood) parts.push(`${typeCounts.flood} flood reports`);
  if (typeCounts.snowfall) parts.push(`${typeCounts.snowfall} snow reports`);
  if (typeCounts.temperature_extreme) parts.push(`${typeCounts.temperature_extreme} temp extremes`);

  return parts.join(', ') || 'No significant reports';
}
