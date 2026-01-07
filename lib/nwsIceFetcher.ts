/**
 * NWS Ice Accumulation Fetcher
 *
 * Fetches NBM-backed ice accumulation (FRAM - Freezing Rain Accumulation Model)
 * from the NWS api.weather.gov gridpoints endpoint.
 *
 * Data source: https://api.weather.gov/gridpoints/{wfo}/{x},{y}
 * Field: iceAccumulation (in mm, converted to inches)
 *
 * This is REAL ice accumulation forecast data from NDFD/NBM, not inferred.
 */

// Cache for NWS grid lookups (WFO/gridX/gridY for each lat/lon)
interface GridLookup {
  wfo: string;
  gridX: number;
  gridY: number;
  fetchedAt: number;
}

const gridLookupCache: Map<string, GridLookup> = new Map();
const GRID_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (grid locations don't change)

// Cache for ice accumulation data
interface IceDataCache {
  dailyIce: Map<string, number>; // date -> ice inches
  fetchedAt: number;
  sourceUrl: string;
}

const iceDataCache: Map<string, IceDataCache> = new Map();
const ICE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface IceAccumulationResult {
  ice_in: number;
  source_url: string;
  valid_time: string | null;
  status: 'ok' | 'no_data' | 'fetch_failed' | 'outside_coverage';
  debug?: string;
}

export interface DailyIceAccumulation {
  date: string;
  ice_in: number;
}

/**
 * Get NWS grid coordinates for a lat/lon
 */
async function getGridForLocation(lat: number, lon: number): Promise<GridLookup | null> {
  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = gridLookupCache.get(cacheKey);

  if (cached && (Date.now() - cached.fetchedAt) < GRID_CACHE_TTL_MS) {
    return cached;
  }

  const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;

  try {
    const response = await fetch(pointsUrl, {
      headers: {
        'User-Agent': 'MaxVelocityWeather/1.0 (weather-app)',
        'Accept': 'application/geo+json',
      },
    });

    if (!response.ok) {
      // Outside NWS coverage (e.g., ocean, foreign country)
      return null;
    }

    const data = await response.json();
    const props = data.properties;

    if (!props?.gridId || props?.gridX === undefined || props?.gridY === undefined) {
      return null;
    }

    const gridLookup: GridLookup = {
      wfo: props.gridId,
      gridX: props.gridX,
      gridY: props.gridY,
      fetchedAt: Date.now(),
    };

    gridLookupCache.set(cacheKey, gridLookup);
    return gridLookup;
  } catch (err) {
    console.warn(`NWS points lookup failed for (${lat}, ${lon}):`, err);
    return null;
  }
}

/**
 * Parse ISO 8601 duration to hours
 */
function parseDurationToHours(duration: string): number {
  // Format: PT1H, PT6H, PT12H, etc.
  const match = duration.match(/PT(\d+)H/);
  return match ? parseInt(match[1], 10) : 1;
}

/**
 * Fetch ice accumulation data from NWS gridpoints
 */
async function fetchIceAccumulationData(
  wfo: string,
  gridX: number,
  gridY: number
): Promise<{ dailyIce: Map<string, number>; sourceUrl: string } | null> {
  const cacheKey = `${wfo}/${gridX}/${gridY}`;
  const cached = iceDataCache.get(cacheKey);

  if (cached && (Date.now() - cached.fetchedAt) < ICE_CACHE_TTL_MS) {
    return { dailyIce: cached.dailyIce, sourceUrl: cached.sourceUrl };
  }

  const gridpointsUrl = `https://api.weather.gov/gridpoints/${wfo}/${gridX},${gridY}`;

  try {
    const response = await fetch(gridpointsUrl, {
      headers: {
        'User-Agent': 'MaxVelocityWeather/1.0 (weather-app)',
        'Accept': 'application/geo+json',
      },
    });

    if (!response.ok) {
      console.warn(`NWS gridpoints fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const iceAccum = data.properties?.iceAccumulation;

    if (!iceAccum?.values || !Array.isArray(iceAccum.values)) {
      return { dailyIce: new Map(), sourceUrl: gridpointsUrl };
    }

    // Aggregate 6-hour periods into daily totals
    // NWS provides ice in mm, convert to inches (1mm = 0.03937 inches)
    const dailyIce = new Map<string, number>();

    for (const period of iceAccum.values) {
      if (period.value === null || period.value === undefined) continue;

      // Parse validTime: "2026-01-05T12:00:00+00:00/PT6H"
      const validTimeParts = period.validTime?.split('/');
      if (!validTimeParts || validTimeParts.length < 1) continue;

      const dateTime = validTimeParts[0];
      const date = dateTime.split('T')[0]; // Extract YYYY-MM-DD

      // Convert mm to inches
      const iceInches = (period.value || 0) * 0.03937;

      // Sum into daily total
      const existing = dailyIce.get(date) || 0;
      dailyIce.set(date, existing + iceInches);
    }

    // Cache the result
    const result = { dailyIce, sourceUrl: gridpointsUrl };
    iceDataCache.set(cacheKey, {
      ...result,
      fetchedAt: Date.now(),
    });

    return result;
  } catch (err) {
    console.warn(`NWS ice accumulation fetch failed:`, err);
    return null;
  }
}

/**
 * Get ice accumulation for a specific city and day
 */
export async function getIceAccumulationForCity(
  cityId: string,
  lat: number,
  lon: number,
  date: string // YYYY-MM-DD format
): Promise<IceAccumulationResult> {
  // Get NWS grid coordinates
  const grid = await getGridForLocation(lat, lon);

  if (!grid) {
    return {
      ice_in: 0,
      source_url: `https://api.weather.gov/points/${lat},${lon}`,
      valid_time: null,
      status: 'outside_coverage',
      debug: 'Location not in NWS coverage area',
    };
  }

  // Fetch ice accumulation data
  const iceData = await fetchIceAccumulationData(grid.wfo, grid.gridX, grid.gridY);

  if (!iceData) {
    return {
      ice_in: 0,
      source_url: `https://api.weather.gov/gridpoints/${grid.wfo}/${grid.gridX},${grid.gridY}`,
      valid_time: null,
      status: 'fetch_failed',
      debug: 'Failed to fetch ice accumulation data',
    };
  }

  const iceIn = iceData.dailyIce.get(date) || 0;

  return {
    ice_in: Math.round(iceIn * 100) / 100, // Round to 2 decimal places
    source_url: iceData.sourceUrl,
    valid_time: date,
    status: iceData.dailyIce.has(date) || iceIn === 0 ? 'ok' : 'no_data',
  };
}

/**
 * Batch fetch ice accumulation for multiple cities (single day)
 * More efficient for region-wide queries
 */
export async function getIceAccumulationForCities(
  cities: Array<{ cityId: string; lat: number; lon: number }>,
  date: string
): Promise<Map<string, IceAccumulationResult>> {
  const results = new Map<string, IceAccumulationResult>();

  // Process cities in parallel with concurrency limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < cities.length; i += BATCH_SIZE) {
    const batch = cities.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(city => getIceAccumulationForCity(city.cityId, city.lat, city.lon, date))
    );

    batch.forEach((city, idx) => {
      results.set(city.cityId, batchResults[idx]);
    });
  }

  return results;
}

/**
 * Get ice accumulation for a city across multiple days
 */
export async function getIceAccumulationForCityDays(
  cityId: string,
  lat: number,
  lon: number,
  days: number = 7
): Promise<DailyIceAccumulation[]> {
  // Get NWS grid coordinates
  const grid = await getGridForLocation(lat, lon);

  if (!grid) {
    // Return empty array for locations outside NWS coverage
    return [];
  }

  // Fetch ice accumulation data
  const iceData = await fetchIceAccumulationData(grid.wfo, grid.gridX, grid.gridY);

  if (!iceData) {
    return [];
  }

  // Build daily results for the requested number of days
  const results: DailyIceAccumulation[] = [];
  const today = new Date();

  for (let d = 0; d < days; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];

    const iceIn = iceData.dailyIce.get(dateStr) || 0;
    results.push({
      date: dateStr,
      ice_in: Math.round(iceIn * 100) / 100,
    });
  }

  return results;
}

/**
 * Clear caches (for testing)
 */
export function clearIceCaches(): void {
  gridLookupCache.clear();
  iceDataCache.clear();
}
