'use client';

import useSWR from 'swr';
import {
  ForecastResponse,
  NarrativeResponse,
  RegionsAPIResponse,
  RegionId,
  CityMetricsSummary,
  NationalForecast,
  RegionDailyData,
  RegionExplainPayload,
} from '@/lib/types';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

/**
 * Hook for fetching weather data from regions API
 */
export function useWeatherData() {
  const {
    data: regionsData,
    error: regionsError,
    isLoading,
    mutate,
  } = useSWR<RegionsAPIResponse>('/api/regions', fetcher, {
    refreshInterval: 1800000, // 30 minutes
    revalidateOnFocus: false,
  });

  // Transform regions array into a record keyed by region ID
  const regionRisks = regionsData?.regions?.reduce((acc, region) => {
    // Convert daily array to day1, day2, etc format - include explain for "why this score"
    const dailyData = region.daily || [];
    acc[region.regionId] = {
      day1: dailyData[0] ? { risk: dailyData[0].score_display, conditions: dailyData[0].forecast_text || 'Typical conditions', explain: dailyData[0].explain } : { risk: 3, conditions: 'Typical conditions' },
      day2: dailyData[1] ? { risk: dailyData[1].score_display, conditions: dailyData[1].forecast_text || 'Typical conditions', explain: dailyData[1].explain } : { risk: 3, conditions: 'Typical conditions' },
      day3: dailyData[2] ? { risk: dailyData[2].score_display, conditions: dailyData[2].forecast_text || 'Typical conditions', explain: dailyData[2].explain } : { risk: 3, conditions: 'Typical conditions' },
      day4: dailyData[3] ? { risk: dailyData[3].score_display, conditions: dailyData[3].forecast_text || 'Typical conditions', explain: dailyData[3].explain } : undefined,
      day5: dailyData[4] ? { risk: dailyData[4].score_display, conditions: dailyData[4].forecast_text || 'Typical conditions', explain: dailyData[4].explain } : undefined,
      day6: dailyData[5] ? { risk: dailyData[5].score_display, conditions: dailyData[5].forecast_text || 'Typical conditions', explain: dailyData[5].explain } : undefined,
      day7: dailyData[6] ? { risk: dailyData[6].score_display, conditions: dailyData[6].forecast_text || 'Typical conditions', explain: dailyData[6].explain } : undefined,
    };
    return acc;
  }, {} as Record<RegionId, any>) || {};

  return {
    data: regionsData ? {
      regions: regionRisks,
      national: regionsData.national,
      fetchedAt: regionsData.fetchedAt,
    } : undefined,
    isLoading,
    isError: !!regionsError,
    error: regionsError,
    mutate,
  };
}

/**
 * Hook for fetching region cities data
 */
export function useRegionCities() {
  const { data, error, isLoading } = useSWR<RegionsAPIResponse>(
    '/api/regions',
    fetcher,
    {
      refreshInterval: 1800000,
      revalidateOnFocus: false,
    }
  );

  // Flatten all cities from all regions
  const allCities = data?.regions?.flatMap(region => region.cities || []) || [];

  return {
    data: allCities,
    regions: data?.regions || [],
    national: data?.national,
    isLoading,
    isError: !!error,
    error,
  };
}

/**
 * Hook for fetching a specific region's data
 */
export function useRegion(regionId: RegionId | null) {
  const { regions, isLoading, isError } = useRegionCities();

  const region = regionId
    ? regions.find((r) => r.regionId === regionId)
    : null;

  return {
    region,
    cities: region?.cities || [],
    daily: region?.daily || [],
    isLoading,
    isError,
  };
}

/**
 * Hook for fetching city-level data
 */
export function useCityForecast(cityId: string | null) {
  const { data, error, isLoading } = useSWR(
    cityId ? `/api/city?city_id=${cityId}` : null,
    fetcher,
    {
      refreshInterval: 1800000,
      revalidateOnFocus: false,
    }
  );

  return {
    city: data?.city,
    explain: data?.explain,
    isLoading,
    isError: !!error,
    error,
  };
}

/**
 * Hook for fetching city narrative
 */
export function useCityNarrative(cityId: string | null, day: number = 0) {
  const { data, error, isLoading } = useSWR(
    cityId ? `/api/city-narrative?city_id=${cityId}&day=${day}` : null,
    fetcher,
    {
      refreshInterval: 3600000,
      revalidateOnFocus: false,
    }
  );

  return {
    narrative: data?.narrative,
    isLoading,
    isError: !!error,
    error,
  };
}
