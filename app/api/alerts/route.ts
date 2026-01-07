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

// Severity ranking (higher = more severe)
const SEVERITY_SCORE: Record<string, number> = {
  Extreme: 5,
  Severe: 4,
  Moderate: 3,
  Minor: 2,
  Unknown: 1
};

// Urgency ranking
const URGENCY_SCORE: Record<string, number> = {
  Immediate: 5,
  Expected: 4,
  Future: 3,
  Past: 2,
  Unknown: 1
};

// Certainty ranking
const CERTAINTY_SCORE: Record<string, number> = {
  Observed: 5,
  Likely: 4,
  Possible: 3,
  Unlikely: 2,
  Unknown: 1
};

// Event type boost (critical warnings get extra points)
const EVENT_BOOST: Record<string, number> = {
  'Tornado Warning': 50,
  'Tornado Emergency': 60,
  'Particularly Dangerous Situation': 55,
  'Flash Flood Warning': 40,
  'Flash Flood Emergency': 50,
  'Severe Thunderstorm Warning': 35,
  'Hurricane Warning': 45,
  'Hurricane Emergency': 55,
  'Tsunami Warning': 50,
  'Extreme Wind Warning': 45,
  'Storm Surge Warning': 40,
  'Blizzard Warning': 30,
  'Ice Storm Warning': 30,
  'Winter Storm Warning': 25,
  'High Wind Warning': 20,
  'Flood Warning': 20,
  'Red Flag Warning': 15,
  'Fire Weather Watch': 10,
  'Heat Advisory': 10,
  'Excessive Heat Warning': 25,
  'Wind Chill Warning': 20,
  'Freeze Warning': 15,
  'Frost Advisory': 5,
  'Dense Fog Advisory': 5,
  'Winter Weather Advisory': 10,
  'Wind Advisory': 5,
  'Coastal Flood Warning': 15,
  'Coastal Flood Advisory': 5
};

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

interface ProcessedAlert {
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
}

/**
 * Calculate ranking score for an alert
 */
function calculateScore(alert: NWSAlert, population: number): number {
  const props = alert.properties;

  const severityScore = (SEVERITY_SCORE[props.severity] || 1) * 10;
  const urgencyScore = (URGENCY_SCORE[props.urgency] || 1) * 8;
  const certaintyScore = (CERTAINTY_SCORE[props.certainty] || 1) * 6;

  // Population score (logarithmic to prevent huge populations from dominating)
  const popScore = population > 0 ? Math.log10(population) * 5 : 0;

  // Event type boost
  const eventBoost = EVENT_BOOST[props.event] || 0;

  return severityScore + urgencyScore + certaintyScore + popScore + eventBoost;
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

    // Sort by score descending and take top 5
    processedAlerts.sort((a, b) => b.score - a.score);
    const topAlerts = processedAlerts.slice(0, 5);

    // Format response
    const responseData = {
      updated: new Date().toISOString(),
      totalActive: features.length,
      alerts: topAlerts.map(alert => ({
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
      }))
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
