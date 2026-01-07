/**
 * NCEI Storm Events Database Fetcher
 *
 * Fetches post-event EF ratings from NOAA/NCEI Storm Events Database.
 * This is used to label EF ratings when available from official surveys.
 *
 * Note: Storm Events data is typically delayed (not real-time), so we
 * check for recently published tornado events with confirmed EF ratings.
 *
 * Source: https://www.ncdc.noaa.gov/stormevents/
 * API: https://www.ncei.noaa.gov/access/services/
 */

import { EventFact, EventFactType } from './types';

const USER_AGENT = 'maxvelocitywx.com (contact@maxvelocitywx.com)';

// Cache for storm events
interface CacheEntry {
  data: EventFact[];
  fetchedAt: number;
}

let stormEventsCache: CacheEntry | null = null;
const STORM_EVENTS_CACHE_TTL = 60 * 60 * 1000; // 1 hour (data isn't real-time)

// Recent tornado events with confirmed EF ratings from Storm Data
// We'll fetch from NCEI's published monthly Storm Data when available
// For now, we also check NWS damage survey products

interface TornadoRating {
  date: string;           // YYYY-MM-DD
  time_utc: string;       // HH:MM
  state: string;
  county: string;
  ef_rating: string;      // EF0-EF5
  path_length: number;    // miles
  path_width: number;     // yards
  fatalities: number;
  injuries: number;
  lat_start: number;
  lon_start: number;
  lat_end?: number;
  lon_end?: number;
  source_url: string;
}

/**
 * Fetch recent tornado EF ratings from NCEI Storm Events API
 *
 * The NCEI has a CSV/JSON API for Storm Events data, though it's
 * typically 2-4 weeks behind real-time. We fetch recent tornado
 * events with confirmed EF ratings.
 */
export async function fetchStormEventsFacts(): Promise<EventFact[]> {
  // Check cache first
  if (stormEventsCache && Date.now() - stormEventsCache.fetchedAt < STORM_EVENTS_CACHE_TTL) {
    return stormEventsCache.data;
  }

  const facts: EventFact[] = [];

  try {
    // NCEI Storm Events API endpoint for recent tornado events
    // This queries the Storm Events database for tornado events in the past 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    // NCEI Storm Events Search API
    // Note: The actual API may require specific formatting
    const url = `https://www.ncei.noaa.gov/access/services/search/v1/data?dataset=storm-events-database&dataTypes=TORNADO&startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}&limit=50&format=json`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (response.ok) {
      const data = await response.json();

      // Parse response based on NCEI's format
      if (data && data.results) {
        for (const event of data.results) {
          if (event.TOR_F_SCALE || event.magnitude_type === 'EF') {
            const efRating = event.TOR_F_SCALE || `EF${event.magnitude}`;
            const state = event.state || event.STATE || 'Unknown';
            const county = event.CZ_NAME || event.county || 'Unknown County';

            facts.push({
              id: `storm-events-${event.EVENT_ID || event.id}`,
              type: 'tornado_rating' as EventFactType,
              magnitude: efRating,
              units: 'EF',
              location_name: `${county}, ${state}`,
              lat: parseFloat(event.BEGIN_LAT) || parseFloat(event.lat) || 0,
              lon: parseFloat(event.BEGIN_LON) || parseFloat(event.lon) || 0,
              state: state,
              timestamp_utc: event.BEGIN_DATE_TIME || event.timestamp || new Date().toISOString(),
              source_name: 'NCEI Storm Events',
              source_url: `https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=${event.EVENT_ID || event.id}`,
              confidence: 'surveyed',
              remarks: event.EVENT_NARRATIVE || event.description,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error fetching NCEI Storm Events:', error);
  }

  // Alternative: Check NWS Damage Assessment Toolkit (DAT) products
  // These are published via NWS WFO websites as Public Information Statements
  try {
    await fetchNWSDamageSurveys(facts);
  } catch (error) {
    console.error('Error fetching NWS damage surveys:', error);
  }

  console.log(`[Storm Events Fetcher] Found ${facts.length} rated tornado events`);

  // Cache the results
  stormEventsCache = { data: facts, fetchedAt: Date.now() };

  return facts;
}

/**
 * Fetch recent NWS Damage Survey products (PNS products with EF ratings)
 *
 * NWS offices publish damage surveys as Public Information Statements (PNS)
 * which contain confirmed EF ratings.
 */
async function fetchNWSDamageSurveys(facts: EventFact[]): Promise<void> {
  try {
    // Check for recent PNS products that might contain damage surveys
    // NWS API endpoint for recent products
    const response = await fetch(
      'https://api.weather.gov/products?type=PNS&limit=20',
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
      }
    );

    if (!response.ok) return;

    const data = await response.json();
    const products = data['@graph'] || [];

    for (const product of products) {
      // Fetch full product text
      try {
        const productResponse = await fetch(product['@id'], {
          headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
          },
        });

        if (!productResponse.ok) continue;

        const productData = await productResponse.json();
        const text = productData.productText || '';

        // Look for EF rating patterns in the text
        const efMatches = text.match(/EF[-\s]?([0-5])\s+tornado/gi);
        if (efMatches && efMatches.length > 0) {
          // Extract the EF rating
          const match = efMatches[0].match(/EF[-\s]?([0-5])/i);
          if (match) {
            const efRating = `EF${match[1]}`;

            // Try to extract location from product
            const issuingOffice = productData.issuingOffice || 'NWS';
            const productTime = productData.issuanceTime || new Date().toISOString();

            facts.push({
              id: `pns-${product.id}`,
              type: 'tornado_rating' as EventFactType,
              magnitude: efRating,
              units: 'EF',
              location_name: `See NWS Survey`,
              lat: 0, // Would need to parse from text
              lon: 0,
              state: 'Unknown',
              timestamp_utc: productTime,
              source_name: `NWS ${issuingOffice} Damage Survey`,
              source_url: product['@id'],
              confidence: 'surveyed',
              remarks: 'Confirmed via NWS damage survey',
            });
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Silently handle errors for this supplementary source
  }
}

/**
 * Clear storm events cache
 */
export function clearStormEventsCache(): void {
  stormEventsCache = null;
}
