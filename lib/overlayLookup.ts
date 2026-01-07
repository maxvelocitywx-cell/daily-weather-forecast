/**
 * Server-side SPC/WPC/WSSI Overlay Lookup
 *
 * Uses official NOAA endpoints with point-in-polygon lookups.
 * SPC data: https://www.spc.noaa.gov/products/outlook/
 * WPC ERO data: https://www.wpc.ncep.noaa.gov/qpf/
 * WSSI data: https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer
 */

import { getSPCForCity, getSPCForCities, SPCCategory, SPCLookupResult } from './spcFetcher';
import { getSPCDay48ForCity, getSPCDay48ForCities, SPCDay48Category, SPCDay48LookupResult } from './spcDay48Fetcher';
import { getEROForCity, getEROForCities, EROCategory, EROLookupResult } from './eroFetcher';
import { getWSIForCity, getWSIForCities, WSSICategory, WSSILookupResult } from './wssiFetcher';
import { CityOverlays } from './riskScoring';

export type { SPCCategory, EROCategory, WSSICategory, SPCDay48Category };
export type { SPCLookupResult, EROLookupResult, WSSILookupResult, SPCDay48LookupResult };

export interface CityOverlayData {
  cityId: string;
  day: number;
  spc: SPCLookupResult;
  spcDay48?: SPCDay48LookupResult;  // Day 4-8 SPC outlook (only present for days 4-8)
  ero: EROLookupResult;
  wssi: WSSILookupResult;
  combined: CityOverlays | undefined;
}

/**
 * Get overlay data for a specific city and day
 * Returns full metadata including source URLs and status
 *
 * Day 1-3: SPC, ERO, WSSI overlays
 * Day 4-5: SPC Day 4-8 + ERO overlays
 * Day 6-8: SPC Day 4-8 probabilistic outlook only
 */
export async function getOverlaysForCity(
  cityId: string,
  lat: number,
  lon: number,
  dayIndex: number
): Promise<CityOverlayData> {
  // Day 4-5: SPC Day 4-8 + ERO overlays
  if (dayIndex >= 4 && dayIndex <= 5) {
    const [spcDay48, ero] = await Promise.all([
      getSPCDay48ForCity(cityId, lat, lon, dayIndex as 4 | 5),
      getEROForCity(cityId, lat, lon, dayIndex as 4 | 5),
    ]);

    // Build combined overlays for risk scoring
    const hasSpcDay48 = spcDay48.category === 'SLGT' || spcDay48.category === 'ENH';
    const hasEro = ero.category !== 'NONE';
    const hasOverlay = hasSpcDay48 || hasEro;

    const combined: CityOverlays | undefined = hasOverlay
      ? {
          spcDay48Category: hasSpcDay48 ? spcDay48.category as 'SLGT' | 'ENH' : undefined,
          spcDay48Dn: hasSpcDay48 ? spcDay48.dn : undefined,
          eroCategory: hasEro ? (ero.category as 'HIGH' | 'MRGL' | 'SLGT' | 'MDT') : undefined,
        }
      : undefined;

    return {
      cityId,
      day: dayIndex,
      spc: {
        category: 'NONE',
        points: 0,
        source_url: 'N/A',
        valid_time: null,
        status: 'outside_coverage',
        debug: 'Day 1-3 SPC not valid for Day 4+',
      },
      spcDay48,
      ero,
      wssi: {
        category: 'NONE',
        points: 0,
        source_url: 'N/A',
        valid_time: null,
        issue_time: null,
        status: 'outside_coverage',
        debug: 'WSSI only valid for days 1-3',
      },
      combined,
    };
  }

  // Day 6-8: Only SPC Day 4-8 probabilistic outlook
  if (dayIndex >= 6 && dayIndex <= 8) {
    const spcDay48 = await getSPCDay48ForCity(cityId, lat, lon, dayIndex as 6 | 7 | 8);

    // Build combined overlays for risk scoring (use spcDay48Category)
    // Only include if category is SLGT or ENH (not NONE)
    const hasOverlay = spcDay48.category === 'SLGT' || spcDay48.category === 'ENH';
    const combined: CityOverlays | undefined = hasOverlay
      ? {
          spcDay48Category: spcDay48.category as 'SLGT' | 'ENH',
          spcDay48Dn: spcDay48.dn,
        }
      : undefined;

    return {
      cityId,
      day: dayIndex,
      spc: {
        category: 'NONE',
        points: 0,
        source_url: 'N/A',
        valid_time: null,
        status: 'outside_coverage',
        debug: 'Day 1-3 SPC not valid for Day 4+',
      },
      spcDay48,
      ero: {
        category: 'NONE',
        points: 0,
        source_url: 'N/A',
        valid_time: null,
        status: 'outside_coverage',
        debug: 'ERO only valid for days 1-5',
      },
      wssi: {
        category: 'NONE',
        points: 0,
        source_url: 'N/A',
        valid_time: null,
        issue_time: null,
        status: 'outside_coverage',
        debug: 'WSSI only valid for days 1-3',
      },
      combined,
    };
  }

  // Day 1-3: SPC, ERO, WSSI overlays
  if (dayIndex >= 1 && dayIndex <= 3) {
    const day = dayIndex as 1 | 2 | 3;

    // Fetch all three in parallel
    const [spc, ero, wssi] = await Promise.all([
      getSPCForCity(cityId, lat, lon, day),
      getEROForCity(cityId, lat, lon, day),
      getWSIForCity(cityId, lat, lon, day),
    ]);

    // Build combined overlays for risk scoring
    const hasAnyOverlay = spc.category !== 'NONE' || ero.category !== 'NONE' || wssi.category !== 'NONE';
    const combined: CityOverlays | undefined = hasAnyOverlay
      ? {
          spcCategory: spc.category !== 'NONE' ? spc.category : undefined,
          eroCategory: ero.category !== 'NONE' ? ero.category : undefined,
          wssiCategory: wssi.category !== 'NONE' ? wssi.category : undefined,
        }
      : undefined;

    return {
      cityId,
      day: dayIndex,
      spc,
      ero,
      wssi,
      combined,
    };
  }

  // Invalid day (< 1 or > 8)
  return {
    cityId,
    day: dayIndex,
    spc: {
      category: 'NONE',
      points: 0,
      source_url: 'N/A',
      valid_time: null,
      status: 'outside_coverage',
      debug: 'Day must be 1-8',
    },
    ero: {
      category: 'NONE',
      points: 0,
      source_url: 'N/A',
      valid_time: null,
      status: 'outside_coverage',
      debug: 'Day must be 1-5',
    },
    wssi: {
      category: 'NONE',
      points: 0,
      source_url: 'N/A',
      valid_time: null,
      issue_time: null,
      status: 'outside_coverage',
      debug: 'Day must be 1-3',
    },
    combined: undefined,
  };
}

/**
 * Get overlay data for multiple cities for a specific day (more efficient batch lookup)
 *
 * Day 1-3: SPC, ERO, WSSI overlays
 * Day 4-5: SPC Day 4-8 + ERO overlays
 * Day 6-8: SPC Day 4-8 probabilistic outlook only
 */
export async function getOverlaysForCities(
  cities: Array<{ cityId: string; lat: number; lon: number }>,
  dayIndex: number
): Promise<Map<string, CityOverlayData>> {
  const results = new Map<string, CityOverlayData>();

  // Day 4-5: SPC Day 4-8 + ERO overlays
  if (dayIndex >= 4 && dayIndex <= 5) {
    const [spcDay48Results, eroResults] = await Promise.all([
      getSPCDay48ForCities(cities, dayIndex as 4 | 5),
      getEROForCities(cities, dayIndex as 4 | 5),
    ]);

    for (const city of cities) {
      const spcDay48 = spcDay48Results.get(city.cityId)!;
      const ero = eroResults.get(city.cityId)!;

      // Build combined overlays for risk scoring
      const hasSpcDay48 = spcDay48.category === 'SLGT' || spcDay48.category === 'ENH';
      const hasEro = ero.category !== 'NONE';
      const hasOverlay = hasSpcDay48 || hasEro;

      const combined: CityOverlays | undefined = hasOverlay
        ? {
            spcDay48Category: hasSpcDay48 ? spcDay48.category as 'SLGT' | 'ENH' : undefined,
            spcDay48Dn: hasSpcDay48 ? spcDay48.dn : undefined,
            eroCategory: hasEro ? (ero.category as 'HIGH' | 'MRGL' | 'SLGT' | 'MDT') : undefined,
          }
        : undefined;

      results.set(city.cityId, {
        cityId: city.cityId,
        day: dayIndex,
        spc: {
          category: 'NONE',
          points: 0,
          source_url: 'N/A',
          valid_time: null,
          status: 'outside_coverage',
          debug: 'Day 1-3 SPC not valid for Day 4+',
        },
        spcDay48,
        ero,
        wssi: {
          category: 'NONE',
          points: 0,
          source_url: 'N/A',
          valid_time: null,
          issue_time: null,
          status: 'outside_coverage',
          debug: 'WSSI only valid for days 1-3',
        },
        combined,
      });
    }
    return results;
  }

  // Day 6-8: Only SPC Day 4-8 probabilistic outlook
  if (dayIndex >= 6 && dayIndex <= 8) {
    const spcDay48Results = await getSPCDay48ForCities(cities, dayIndex as 6 | 7 | 8);

    for (const city of cities) {
      const spcDay48 = spcDay48Results.get(city.cityId)!;

      // Only include if category is SLGT or ENH (not NONE)
      const hasOverlay = spcDay48.category === 'SLGT' || spcDay48.category === 'ENH';
      const combined: CityOverlays | undefined = hasOverlay
        ? {
            spcDay48Category: spcDay48.category as 'SLGT' | 'ENH',
            spcDay48Dn: spcDay48.dn,
          }
        : undefined;

      results.set(city.cityId, {
        cityId: city.cityId,
        day: dayIndex,
        spc: {
          category: 'NONE',
          points: 0,
          source_url: 'N/A',
          valid_time: null,
          status: 'outside_coverage',
          debug: 'Day 1-3 SPC not valid for Day 4+',
        },
        spcDay48,
        ero: {
          category: 'NONE',
          points: 0,
          source_url: 'N/A',
          valid_time: null,
          status: 'outside_coverage',
          debug: 'ERO only valid for days 1-5',
        },
        wssi: {
          category: 'NONE',
          points: 0,
          source_url: 'N/A',
          valid_time: null,
          issue_time: null,
          status: 'outside_coverage',
          debug: 'WSSI only valid for days 1-3',
        },
        combined,
      });
    }
    return results;
  }

  // Day 1-3: SPC, ERO, WSSI overlays
  if (dayIndex >= 1 && dayIndex <= 3) {
    const day = dayIndex as 1 | 2 | 3;

    // Fetch all three in parallel
    const [spcResults, eroResults, wssiResults] = await Promise.all([
      getSPCForCities(cities, day),
      getEROForCities(cities, day),
      getWSIForCities(cities, day),
    ]);

    // Combine results
    for (const city of cities) {
      const spc = spcResults.get(city.cityId)!;
      const ero = eroResults.get(city.cityId)!;
      const wssi = wssiResults.get(city.cityId)!;

      const hasAnyOverlay = spc.category !== 'NONE' || ero.category !== 'NONE' || wssi.category !== 'NONE';
      const combined: CityOverlays | undefined = hasAnyOverlay
        ? {
            spcCategory: spc.category !== 'NONE' ? spc.category : undefined,
            eroCategory: ero.category !== 'NONE' ? ero.category : undefined,
            wssiCategory: wssi.category !== 'NONE' ? wssi.category : undefined,
          }
        : undefined;

      results.set(city.cityId, {
        cityId: city.cityId,
        day: dayIndex,
        spc,
        ero,
        wssi,
        combined,
      });
    }
    return results;
  }

  // Invalid day (< 1 or > 8)
  for (const city of cities) {
    results.set(city.cityId, {
      cityId: city.cityId,
      day: dayIndex,
      spc: {
        category: 'NONE',
        points: 0,
        source_url: 'N/A',
        valid_time: null,
        status: 'outside_coverage',
        debug: 'Day must be 1-8',
      },
      ero: {
        category: 'NONE',
        points: 0,
        source_url: 'N/A',
        valid_time: null,
        status: 'outside_coverage',
        debug: 'Day must be 1-5',
      },
      wssi: {
        category: 'NONE',
        points: 0,
        source_url: 'N/A',
        valid_time: null,
        issue_time: null,
        status: 'outside_coverage',
        debug: 'Day must be 1-3',
      },
      combined: undefined,
    });
  }
  return results;
}

/**
 * Synchronous version for backward compatibility - but now async internally
 * This is a wrapper that should be replaced with async calls
 * @deprecated Use getOverlaysForCity instead
 */
export function getCityOverlaysForDay(cityId: string, dayIndex: number): CityOverlays | undefined {
  // This function was synchronous but now needs to be async
  // For backward compatibility, return undefined (no overlays)
  // The API routes should be updated to use async getOverlaysForCity
  console.warn(`getCityOverlaysForDay called synchronously for ${cityId} day ${dayIndex} - should use async getOverlaysForCity`);
  return undefined;
}

/**
 * Check if any overlays are active for a city across days 1-3
 */
export async function hasActiveOverlays(
  cityId: string,
  lat: number,
  lon: number
): Promise<boolean> {
  const results = await Promise.all([
    getOverlaysForCity(cityId, lat, lon, 1),
    getOverlaysForCity(cityId, lat, lon, 2),
    getOverlaysForCity(cityId, lat, lon, 3),
  ]);

  return results.some(r => r.combined !== undefined);
}
