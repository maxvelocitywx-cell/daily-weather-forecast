/**
 * Xweather API Client
 *
 * Handles authentication, rate limiting, and caching for Xweather API requests.
 */

import {
  XweatherAPIResponse,
  XweatherObservation,
  XweatherStormReport,
  XweatherAlert,
} from './types';

// ============================================================================
// CONFIGURATION
// ============================================================================

const XWEATHER_BASE_URL = 'https://api.aerisapi.com';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Rate limiting
const MAX_REQUESTS_PER_MINUTE = 50;
let requestCount = 0;
let lastResetTime = Date.now();

// ============================================================================
// CACHE
// ============================================================================

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const cache: Map<string, CacheEntry<unknown>> = new Map();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) {
    return entry.data as T;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

export function clearCache(): void {
  cache.clear();
}

// ============================================================================
// RATE LIMITING
// ============================================================================

function checkRateLimit(): boolean {
  const now = Date.now();

  // Reset counter every minute
  if (now - lastResetTime > 60000) {
    requestCount = 0;
    lastResetTime = now;
  }

  if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
    console.warn('[Xweather Client] Rate limit reached, request blocked');
    return false;
  }

  requestCount++;
  return true;
}

// ============================================================================
// API CLIENT
// ============================================================================

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.XWEATHER_CLIENT_ID;
  const clientSecret = process.env.XWEATHER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET must be set');
  }

  return { clientId, clientSecret };
}

async function fetchFromXweather<T>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<XweatherAPIResponse<T>> {
  // Check rate limit
  if (!checkRateLimit()) {
    return {
      success: false,
      error: { code: 'rate_limit', description: 'Rate limit exceeded' },
      response: [],
    };
  }

  const { clientId, clientSecret } = getCredentials();

  // Build URL with params
  const url = new URL(`${XWEATHER_BASE_URL}${endpoint}`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('format', 'json');

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[Xweather Client] HTTP error: ${response.status}`);
      return {
        success: false,
        error: { code: String(response.status), description: response.statusText },
        response: [],
      };
    }

    const data = await response.json();
    return data as XweatherAPIResponse<T>;
  } catch (error) {
    console.error('[Xweather Client] Fetch error:', error);
    return {
      success: false,
      error: { code: 'fetch_error', description: String(error) },
      response: [],
    };
  }
}

// ============================================================================
// OBSERVATIONS API
// ============================================================================

/**
 * Fetch observations for multiple locations
 * Uses the observations/summary endpoint for efficient bulk queries
 */
export async function fetchObservations(
  locations: string[] = ['us']
): Promise<XweatherObservation[]> {
  const cacheKey = `observations-${locations.join('-')}`;
  const cached = getCached<XweatherObservation[]>(cacheKey);
  if (cached) {
    console.log('[Xweather Client] Observations cache hit');
    return cached;
  }

  console.log('[Xweather Client] Fetching observations...');

  // Fetch observations within the US with significant weather
  // Using search filter for notable conditions
  const response = await fetchFromXweather<XweatherObservation>(
    '/observations/search',
    {
      query: 'country:us',
      filter: 'windgustmph:gte:50,OR,tempf:gte:105,OR,tempf:lte:0',
      limit: '100',
      sort: 'windgustmph:desc',
    }
  );

  if (!response.success || !response.response) {
    console.error('[Xweather Client] Observations fetch failed:', response.error);
    return [];
  }

  const observations = response.response;
  console.log(`[Xweather Client] Fetched ${observations.length} observations`);

  setCache(cacheKey, observations);
  return observations;
}

/**
 * Fetch observations for specific stations
 */
export async function fetchStationObservations(
  stationIds: string[]
): Promise<XweatherObservation[]> {
  const cacheKey = `station-obs-${stationIds.join('-')}`;
  const cached = getCached<XweatherObservation[]>(cacheKey);
  if (cached) return cached;

  const results: XweatherObservation[] = [];

  // Batch station requests
  const batchSize = 10;
  for (let i = 0; i < stationIds.length; i += batchSize) {
    const batch = stationIds.slice(i, i + batchSize);
    const stationQuery = batch.join(',');

    const response = await fetchFromXweather<XweatherObservation>(
      `/observations/${stationQuery}`,
      {}
    );

    if (response.success && response.response) {
      results.push(...response.response);
    }
  }

  setCache(cacheKey, results);
  return results;
}

// ============================================================================
// STORM REPORTS API
// ============================================================================

/**
 * Fetch recent storm reports
 */
export async function fetchStormReports(
  hoursBack: number = 6
): Promise<XweatherStormReport[]> {
  const cacheKey = `storm-reports-${hoursBack}h`;
  const cached = getCached<XweatherStormReport[]>(cacheKey);
  if (cached) {
    console.log('[Xweather Client] Storm reports cache hit');
    return cached;
  }

  console.log('[Xweather Client] Fetching storm reports...');

  const response = await fetchFromXweather<XweatherStormReport>(
    '/stormreports/search',
    {
      query: 'country:us',
      from: `-${hoursBack}hours`,
      limit: '200',
      sort: 'dt:desc',
    }
  );

  if (!response.success || !response.response) {
    console.error('[Xweather Client] Storm reports fetch failed:', response.error);
    return [];
  }

  const reports = response.response;
  console.log(`[Xweather Client] Fetched ${reports.length} storm reports`);

  setCache(cacheKey, reports);
  return reports;
}

// ============================================================================
// ALERTS API
// ============================================================================

/**
 * Fetch active weather alerts
 */
export async function fetchAlerts(): Promise<XweatherAlert[]> {
  const cacheKey = 'alerts';
  const cached = getCached<XweatherAlert[]>(cacheKey);
  if (cached) {
    console.log('[Xweather Client] Alerts cache hit');
    return cached;
  }

  console.log('[Xweather Client] Fetching alerts...');

  const response = await fetchFromXweather<XweatherAlert>(
    '/alerts/search',
    {
      query: 'country:us',
      filter: 'active',
      limit: '500',
      sort: 'severity:desc',
    }
  );

  if (!response.success || !response.response) {
    console.error('[Xweather Client] Alerts fetch failed:', response.error);
    return [];
  }

  const alerts = response.response;
  console.log(`[Xweather Client] Fetched ${alerts.length} active alerts`);

  setCache(cacheKey, alerts);
  return alerts;
}

/**
 * Fetch alerts filtered by type
 */
export async function fetchAlertsByType(
  types: string[]
): Promise<XweatherAlert[]> {
  const allAlerts = await fetchAlerts();

  return allAlerts.filter(alert => {
    const alertType = alert.details?.type?.toLowerCase() || '';
    const alertName = alert.details?.name?.toLowerCase() || '';

    return types.some(type => {
      const typeLower = type.toLowerCase();
      return alertType.includes(typeLower) || alertName.includes(typeLower);
    });
  });
}

// ============================================================================
// THREATS API (if available in your Xweather plan)
// ============================================================================

/**
 * Fetch active threats/hazards
 */
export async function fetchThreats(): Promise<unknown[]> {
  const cacheKey = 'threats';
  const cached = getCached<unknown[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchFromXweather<unknown>(
      '/threats/search',
      {
        query: 'country:us',
        limit: '100',
      }
    );

    if (!response.success || !response.response) {
      return [];
    }

    setCache(cacheKey, response.response);
    return response.response;
  } catch {
    // Threats endpoint may not be available in all plans
    return [];
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Verify Xweather API credentials and connectivity
 */
export async function checkXweatherHealth(): Promise<{
  healthy: boolean;
  message: string;
}> {
  try {
    const response = await fetchFromXweather<XweatherObservation>(
      '/observations/KJFK',
      {}
    );

    if (response.success) {
      return { healthy: true, message: 'Xweather API connected' };
    } else {
      return {
        healthy: false,
        message: `Xweather API error: ${response.error?.description}`,
      };
    }
  } catch (error) {
    return {
      healthy: false,
      message: `Xweather API unreachable: ${error}`,
    };
  }
}
