import { NextRequest, NextResponse } from 'next/server';
import type { Feature, FeatureCollection } from 'geojson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 minute cache

// ArcGIS MapServer layer IDs for Overall Impact
const WSSI_LAYER_IDS: Record<number, number> = {
  1: 1, // Overall_Impact_Day_1
  2: 2, // Overall_Impact_Day_2
  3: 3, // Overall_Impact_Day_3
};

const MAPSERVER_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer';

// WSSI categories in severity order (low to high)
type WSSICategory = 'elevated' | 'minor' | 'moderate' | 'major' | 'extreme';

// Map WSSI categories to display labels
const WSSI_CATEGORY_LABELS: Record<WSSICategory, string> = {
  'elevated': 'Winter Weather Area',
  'minor': 'Minor Impacts',
  'moderate': 'Moderate Impacts',
  'major': 'Major Impacts',
  'extreme': 'Extreme Impacts',
};

// Map to risk labels
const WSSI_TO_RISK: Record<WSSICategory, string> = {
  'elevated': 'Marginal Risk',
  'minor': 'Slight Risk',
  'moderate': 'Enhanced Risk',
  'major': 'Moderate Risk',
  'extreme': 'High Risk',
};

// Risk colors
const RISK_COLORS: Record<string, string> = {
  'Marginal Risk': '#60A5FA',
  'Slight Risk': '#2563EB',
  'Enhanced Risk': '#7C3AED',
  'Moderate Risk': '#A21CAF',
  'High Risk': '#DC2626',
};

// Risk order for sorting
const RISK_ORDER: Record<string, number> = {
  'Marginal Risk': 1,
  'Slight Risk': 2,
  'Enhanced Risk': 3,
  'Moderate Risk': 4,
  'High Risk': 5,
};

// Cache - simple raw data cache
const wssiCache = new Map<string, { data: FeatureCollection; timestamp: number; lastModified: string }>();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Extract WSSI category from feature properties
 * Returns null if category cannot be determined (feature will be omitted)
 */
function extractCategory(properties: Record<string, unknown>): WSSICategory | null {
  // ArcGIS MapServer uses 'impact' field for the category
  const possibleProps = ['impact', 'idp_wssilabel', 'label', 'Label', 'LABEL', 'name', 'Name'];

  for (const prop of possibleProps) {
    if (properties[prop]) {
      const value = String(properties[prop]).toLowerCase().trim();

      // Check for exact matches first
      if (value === 'extreme' || value === 'extreme impacts') return 'extreme';
      if (value === 'major' || value === 'major impacts') return 'major';
      if (value === 'moderate' || value === 'moderate impacts') return 'moderate';
      if (value === 'minor' || value === 'minor impacts') return 'minor';
      if (value === 'elevated' || value === 'winter weather area') return 'elevated';

      // Check for partial matches
      if (value.includes('extreme')) return 'extreme';
      if (value.includes('major')) return 'major';
      if (value.includes('moderate')) return 'moderate';
      if (value.includes('minor')) return 'minor';
      if (value.includes('elevated') || value.includes('winter weather')) return 'elevated';
    }
  }

  return null;
}

/**
 * Lightweight server-side processing:
 * - Just categorize and add metadata
 * - Heavy smoothing/banding done client-side
 */
async function fetchWSSIData(day: number): Promise<{ geojson: FeatureCollection; lastModified: string }> {
  const layerId = WSSI_LAYER_IDS[day];
  if (!layerId) {
    throw new Error(`Invalid day: ${day}`);
  }

  // Fetch from ArcGIS MapServer
  const queryUrl = `${MAPSERVER_BASE}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true`;

  const response = await fetch(queryUrl, {
    headers: { 'User-Agent': 'maxvelocitywx.com' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch WSSI data: ${response.status}`);
  }

  const lastModified = response.headers.get('Last-Modified') || new Date().toISOString();
  const rawData = await response.json() as FeatureCollection;

  if (!rawData.features || rawData.features.length === 0) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      lastModified,
    };
  }

  // Just add metadata - don't do heavy processing server-side
  const processedFeatures: Feature[] = [];

  for (const feature of rawData.features) {
    if (!feature.geometry) continue;
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;

    const category = extractCategory((feature.properties || {}) as Record<string, unknown>);
    if (category === null) continue;

    const riskLabel = WSSI_TO_RISK[category];
    const originalCategory = WSSI_CATEGORY_LABELS[category];
    const riskColor = RISK_COLORS[riskLabel];
    const riskOrder = RISK_ORDER[riskLabel];

    processedFeatures.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        day,
        category,
        originalCategory,
        riskLabel,
        riskColor,
        riskOrder,
        validTime: lastModified,
      },
    });
  }

  // Sort by risk order (lower severity first, so higher severity renders on top)
  processedFeatures.sort((a, b) =>
    (a.properties?.riskOrder || 0) - (b.properties?.riskOrder || 0)
  );

  return {
    geojson: {
      type: 'FeatureCollection',
      features: processedFeatures,
    },
    lastModified,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ day: string }> }
) {
  const { day: dayStr } = await params;
  const day = parseInt(dayStr, 10);

  if (isNaN(day) || day < 1 || day > 3) {
    return NextResponse.json(
      { error: 'Invalid day parameter. Must be 1, 2, or 3.' },
      { status: 400 }
    );
  }

  // Check cache
  const cacheKey = `wssi-day-${day}`;
  const cached = wssiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-WSSI-Last-Modified': cached.lastModified,
      },
    });
  }

  try {
    const { geojson, lastModified } = await fetchWSSIData(day);

    // Update cache
    wssiCache.set(cacheKey, {
      data: geojson,
      timestamp: Date.now(),
      lastModified,
    });

    return NextResponse.json(geojson, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-WSSI-Last-Modified': lastModified,
      },
    });
  } catch (error) {
    console.error('Error fetching WSSI data:', error);

    return NextResponse.json(
      {
        type: 'FeatureCollection',
        features: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      }
    );
  }
}
