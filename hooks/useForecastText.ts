'use client';

import useSWR, { mutate } from 'swr';
import { RegionId, DayExplainPayload } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface ForecastTextData {
  region: RegionId;
  date: string;
  forecast_text: string;
  generated_at: string;
}

/**
 * Cache for prefetched forecast texts
 */
const prefetchCache = new Map<string, ForecastTextData>();

/**
 * Build cache key for forecast text
 */
function buildCacheKey(regionId: RegionId, date: string): string {
  return `/api/forecast-text?region=${regionId}&date=${date}`;
}

/**
 * Hook for fetching forecast text for a specific region and day
 */
export function useForecastText(
  regionIdOrType: RegionId | 'national',
  date?: string,
  explain?: DayExplainPayload,
  enabled: boolean = true
) {
  // Simple national narrative - fetch from narrative API
  const isNational = regionIdOrType === 'national';
  const cacheKey = isNational
    ? '/api/narrative'
    : buildCacheKey(regionIdOrType as RegionId, date || '');

  const { data, error, isLoading } = useSWR(
    enabled && (isNational || date) ? cacheKey : null,
    fetcher,
    {
      refreshInterval: 3600000, // 1 hour
      revalidateOnFocus: false,
      fallbackData: !isNational ? prefetchCache.get(cacheKey) : undefined,
    }
  );

  // For national, extract the overview text
  const narrative = isNational ? data?.national?.overview : data?.forecast_text;

  return {
    data,
    narrative,
    isLoading: enabled && isLoading,
    isError: !!error,
    error,
  };
}

/**
 * Prefetch forecast texts for multiple days
 */
export async function prefetchForecastTexts(
  regionId: RegionId,
  dates: string[],
  dayExplains?: Map<string, DayExplainPayload>
) {
  const promises = dates.map(async (date) => {
    const cacheKey = buildCacheKey(regionId, date);

    // Skip if already cached
    if (prefetchCache.has(cacheKey)) {
      return;
    }

    try {
      const response = await fetch(cacheKey);
      if (response.ok) {
        const data = await response.json();
        prefetchCache.set(cacheKey, data);
        // Update SWR cache
        mutate(cacheKey, data, false);
      }
    } catch (error) {
      console.error(`Failed to prefetch forecast text for ${date}:`, error);
    }
  });

  await Promise.all(promises);
}

/**
 * Clear prefetch cache
 */
export function clearForecastTextCache() {
  prefetchCache.clear();
}
