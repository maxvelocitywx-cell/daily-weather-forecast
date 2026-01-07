import { NextResponse } from 'next/server';
import {
  parseGeocode,
  calculatePopulation,
  getStatesFromFips
} from '@/lib/county-population';

export const runtime = 'nodejs';
export const revalidate = 30; // Cache for 30 seconds

// NWS API User-Agent (required)
const USER_AGENT = 'maxvelocitywx.com (contact@maxvelocitywx.com)';

// Severity base scores (higher = more severe)
const SEVERITY_BASE: Record<string, number> = {
  Extreme: 100,
  Severe: 75,
  Moderate: 50,
  Minor: 25,
  Unknown: 10
};

// Urgency ranking
const URGENCY_SCORE: Record<string, number> = {
  Immediate: 20,
  Expected: 15,
  Future: 10,
  Past: 5,
  Unknown: 0
};

// Certainty ranking
const CERTAINTY_SCORE: Record<string, number> = {
  Observed: 15,
  Likely: 12,
  Possible: 8,
  Unlikely: 4,
  Unknown: 0
};

// Event type boost - critical warnings get extra points
const EVENT_BOOST: Record<string, number> = {
  // Tornado events (+30)
  'Tornado Warning': 30,
  'Tornado Emergency': 35,
  'Tornado Watch': 15,
  // Flash flood events (+30)
  'Flash Flood Warning': 30,
  'Flash Flood Emergency': 35,
  'Flash Flood Watch': 15,
  // Severe thunderstorm/blizzard/ice/hurricane (+15)
  'Severe Thunderstorm Warning': 15,
  'Severe Thunderstorm Watch': 10,
  'Blizzard Warning': 15,
  'Blizzard Watch': 10,
  'Ice Storm Warning': 15,
  'Hurricane Warning': 15,
  'Hurricane Watch': 10,
  'Hurricane Emergency': 20,
  // Other high-impact events
  'Tsunami Warning': 30,
  'Extreme Wind Warning': 20,
  'Storm Surge Warning': 20,
  'Particularly Dangerous Situation': 25,
  'Winter Storm Warning': 10,
  'High Wind Warning': 8,
  'Flood Warning': 8,
  'Red Flag Warning': 8,
  'Excessive Heat Warning': 10,
  'Wind Chill Warning': 8,
  'Fire Weather Watch': 5,
  'Heat Advisory': 5,
  'Freeze Warning': 5,
  'Winter Weather Advisory': 5,
  'Wind Advisory': 3,
  'Coastal Flood Warning': 8,
  'Frost Advisory': 2,
  'Dense Fog Advisory': 2,
  'Coastal Flood Advisory': 3
};

// Keywords that indicate considerable/catastrophic impact
const IMPACT_KEYWORDS = ['considerable', 'catastrophic', 'life-threatening', 'extremely dangerous', 'particularly dangerous'];

interface NWSAlert {
  id: string;
  type: string;
  properties: {
    id: string;
    areaDesc: string;
    geocode: {
      SAME?: string[];
      UGC?: string[];
    };
    affectedZones?: string[];
    sent: string;
    effective: string;
    onset?: string;
    expires: string;
    ends?: string;
    status: string;
    messageType: string;
    category: string;
    severity: string;
    certainty: string;
    urgency: string;
    event: string;
    sender: string;
    senderName: string;
    headline?: string;
    description?: string;
    instruction?: string;
    response: string;
    parameters?: Record<string, string[]>;
  };
  geometry?: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

export interface ProcessedAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  effective: string;
  expires: string;
  ends: string | null;
  onset: string | null;
  areaDesc: string;
  states: string[];
  population: {
    total: number;
    byState: Record<string, number>;
    topCounties: Array<{ fips: string; name: string; population: number }>;
  };
  score: number;
  hasGeometry: boolean;
  geometry: NWSAlert['geometry'] | null;
  sender: string;
  messageType: string;
  // For formatted display
  populationFormatted?: string;
}

/**
 * Calculate deterministic ranking score for an alert
 * Higher score = more important alert
 */
function calculateScore(alert: NWSAlert, population: number): number {
  const props = alert.properties;
  const now = Date.now();

  // Base severity score (0-100)
  let score = SEVERITY_BASE[props.severity] || 10;

  // Add urgency score (0-20)
  score += URGENCY_SCORE[props.urgency] || 0;

  // Add certainty score (0-15)
  score += CERTAINTY_SCORE[props.certainty] || 0;

  // Add event type boost (0-35)
  score += EVENT_BOOST[props.event] || 0;

  // Check for impact keywords in headline/description (+10)
  const textToCheck = `${props.headline || ''} ${props.description || ''} ${props.event || ''}`.toLowerCase();
  if (IMPACT_KEYWORDS.some(kw => textToCheck.includes(kw))) {
    score += 10;
  }

  // Population score (0-20, logarithmic)
  if (population > 0) {
    // Log scale: 1K=3, 10K=4, 100K=5, 1M=6, 10M=7
    const logPop = Math.log10(population);
    score += Math.min(20, Math.max(0, (logPop - 3) * 5));
  }

  // Onset timing bonus (+10 if within 3 hours)
  const onset = props.onset ? new Date(props.onset).getTime() : new Date(props.effective).getTime();
  const hoursUntilOnset = (onset - now) / (1000 * 60 * 60);
  if (hoursUntilOnset <= 3 && hoursUntilOnset >= -1) {
    score += 10;
  }

  // Penalty for expiring soon (-5 if <30 min remaining)
  const expires = new Date(props.expires).getTime();
  const minutesRemaining = (expires - now) / (1000 * 60);
  if (minutesRemaining < 30 && minutesRemaining > 0) {
    score -= 5;
  }

  return Math.round(score * 100) / 100; // Round to 2 decimal places for stability
}

/**
 * Create a deduplication key for an alert
 */
function getDedupeKey(alert: NWSAlert): string {
  const props = alert.properties;
  // Dedupe by event type + sorted UGC codes
  const ugcs = [...(props.geocode.UGC || [])].sort().join(',');
  return `${props.event}|${ugcs}`;
}

/**
 * Format population number (e.g., 3420000 -> "3.42M")
 */
function formatPopulation(pop: number): string {
  if (pop >= 1_000_000) {
    return (pop / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  }
  if (pop >= 1_000) {
    return (pop / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K';
  }
  return pop.toString();
}

/**
 * Stable sort comparator for alerts
 */
function compareAlerts(a: ProcessedAlert, b: ProcessedAlert): number {
  // Primary: score descending
  if (b.score !== a.score) return b.score - a.score;

  // Secondary: severity
  const sevOrder = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];
  const sevA = sevOrder.indexOf(a.severity);
  const sevB = sevOrder.indexOf(b.severity);
  if (sevA !== sevB) return sevA - sevB;

  // Tertiary: onset sooner
  const onsetA = a.onset ? new Date(a.onset).getTime() : new Date(a.effective).getTime();
  const onsetB = b.onset ? new Date(b.onset).getTime() : new Date(b.effective).getTime();
  if (onsetA !== onsetB) return onsetA - onsetB;

  // Quaternary: expires later
  const expA = new Date(a.expires).getTime();
  const expB = new Date(b.expires).getTime();
  if (expA !== expB) return expB - expA;

  // Final: stable by ID
  return a.id.localeCompare(b.id);
}

export async function GET() {
  try {
    // Fetch active alerts from NWS API
    const response = await fetch('https://api.weather.gov/alerts/active', {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': USER_AGENT
      },
      next: { revalidate: 30 }
    });

    if (!response.ok) {
      throw new Error(`NWS API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const features = data.features as NWSAlert[];

    // Process and score each alert
    const processedAlerts: ProcessedAlert[] = [];
    const seenKeys = new Set<string>();

    for (const alert of features) {
      const props = alert.properties;

      // Skip cancelled/expired alerts
      if (props.status === 'Cancel' || props.messageType === 'Cancel') {
        continue;
      }

      // Skip alerts that have expired
      const expiresDate = new Date(props.expires);
      if (expiresDate < new Date()) {
        continue;
      }

      // Deduplicate
      const dedupeKey = getDedupeKey(alert);
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);

      // Parse geocodes to get county FIPS codes
      const fipsCodes = parseGeocode(props.geocode);
      const populationData = calculatePopulation(fipsCodes);
      const states = getStatesFromFips(fipsCodes);

      // Calculate ranking score
      const score = calculateScore(alert, populationData.total);

      processedAlerts.push({
        id: props.id,
        event: props.event,
        severity: props.severity,
        urgency: props.urgency,
        certainty: props.certainty,
        headline: props.headline || null,
        description: props.description || null,
        instruction: props.instruction || null,
        effective: props.effective,
        expires: props.expires,
        ends: props.ends || null,
        onset: props.onset || null,
        areaDesc: props.areaDesc,
        states,
        population: populationData,
        score,
        hasGeometry: !!alert.geometry,
        geometry: alert.geometry || null,
        sender: props.senderName,
        messageType: props.messageType
      });
    }

    // Sort by score descending with stable tie-breakers
    processedAlerts.sort(compareAlerts);

    // Split into top 5 and rest
    const top5Alerts = processedAlerts.slice(0, 5);
    const otherAlerts = processedAlerts.slice(5);

    // Format response
    const formatAlert = (alert: ProcessedAlert) => ({
      ...alert,
      populationFormatted: formatPopulation(alert.population.total),
      population: {
        ...alert.population,
        totalFormatted: formatPopulation(alert.population.total),
        byStateFormatted: Object.fromEntries(
          Object.entries(alert.population.byState).map(([state, pop]) => [
            state,
            formatPopulation(pop)
          ])
        )
      }
    });

    const responseData = {
      updated: new Date().toISOString(),
      totalActive: processedAlerts.length,
      totalRaw: features.length,
      top5: top5Alerts.map(formatAlert),
      other: otherAlerts.map(formatAlert),
      // Also include combined for backwards compatibility
      alerts: top5Alerts.map(formatAlert)
    };

    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 's-maxage=30, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weather alerts' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
