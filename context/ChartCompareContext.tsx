'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useMemo } from 'react';
import { CityMetricsSummary, CityDailySummary, CityDailyRisk } from '@/lib/types';

// Types for chart series data
export interface ChartSeriesPoint {
  day: number;
  dayLabel: string;
  dayDate: string;
  value: number | null;
}

export interface ChartSeries {
  cityId: string;
  cityName: string;
  cityState: string;
  color: string;
  isPrimary: boolean;
  data: ChartSeriesPoint[];
}

export type ChartMetric = 'risk' | 'tempHigh' | 'tempLow' | 'rain' | 'snow' | 'windGust';

// Comparison city colors (for up to 4 comparison cities)
const COMPARE_COLORS = [
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#22c55e', // green
  '#f43f5e', // rose
];

// Primary city colors by metric
const PRIMARY_COLORS: Record<ChartMetric, string> = {
  risk: '#f59e0b',      // amber
  tempHigh: '#f97316',  // orange
  tempLow: '#3b82f6',   // blue
  rain: '#3b82f6',      // blue
  snow: '#8b5cf6',      // purple
  windGust: '#06b6d4',  // cyan
};

interface ChartCompareContextValue {
  // Compare city IDs (shared across all charts)
  compareCityIds: string[];

  // Add/remove comparison cities
  addCompareCity: (cityId: string) => void;
  removeCompareCity: (cityId: string) => void;
  clearCompareCities: () => void;
  toggleCompareCity: (cityId: string) => void;

  // Maximum number of comparison cities allowed
  maxCompareCities: number;

  // Get color for a comparison city by index
  getCompareColor: (index: number) => string;

  // Get primary color for a metric
  getPrimaryColor: (metric: ChartMetric) => string;

  // Compare mode visibility
  showCompare: boolean;
  setShowCompare: (show: boolean) => void;

  // Available cities for comparison (set by parent component)
  availableCities: CityMetricsSummary[];
  setAvailableCities: (cities: CityMetricsSummary[]) => void;

  // Primary city data (the main city being viewed)
  primaryCity: {
    id: string;
    name: string;
    state: string;
    dailySummary: CityDailySummary[];
    dailyRisks: CityDailyRisk[];
  } | null;
  setPrimaryCity: (city: {
    id: string;
    name: string;
    state: string;
    dailySummary: CityDailySummary[];
    dailyRisks: CityDailyRisk[];
  } | null) => void;

  // Get series data for a specific metric
  getSeries: (metric: ChartMetric) => ChartSeries[];

  // Get a specific compare city's data
  getCompareCity: (cityId: string) => CityMetricsSummary | undefined;
}

const ChartCompareContext = createContext<ChartCompareContextValue | null>(null);

export function ChartCompareProvider({ children }: { children: ReactNode }) {
  const [compareCityIds, setCompareCityIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [availableCities, setAvailableCities] = useState<CityMetricsSummary[]>([]);
  const [primaryCity, setPrimaryCity] = useState<{
    id: string;
    name: string;
    state: string;
    dailySummary: CityDailySummary[];
    dailyRisks: CityDailyRisk[];
  } | null>(null);

  const maxCompareCities = 4;

  const addCompareCity = useCallback((cityId: string) => {
    setCompareCityIds(prev => {
      if (prev.includes(cityId) || prev.length >= maxCompareCities) return prev;
      return [...prev, cityId];
    });
  }, []);

  const removeCompareCity = useCallback((cityId: string) => {
    setCompareCityIds(prev => prev.filter(id => id !== cityId));
  }, []);

  const clearCompareCities = useCallback(() => {
    setCompareCityIds([]);
  }, []);

  const toggleCompareCity = useCallback((cityId: string) => {
    setCompareCityIds(prev => {
      if (prev.includes(cityId)) {
        return prev.filter(id => id !== cityId);
      }
      if (prev.length >= maxCompareCities) return prev;
      return [...prev, cityId];
    });
  }, []);

  const getCompareColor = useCallback((index: number) => {
    return COMPARE_COLORS[index % COMPARE_COLORS.length];
  }, []);

  const getPrimaryColor = useCallback((metric: ChartMetric) => {
    return PRIMARY_COLORS[metric];
  }, []);

  const getCompareCity = useCallback((cityId: string) => {
    return availableCities.find(c => c.cityId === cityId);
  }, [availableCities]);

  // Build series data for a metric
  const getSeries = useCallback((metric: ChartMetric): ChartSeries[] => {
    const series: ChartSeries[] = [];

    // Primary city series
    if (primaryCity && primaryCity.dailySummary.length > 0) {
      const data: ChartSeriesPoint[] = primaryCity.dailySummary.map((summary, i) => {
        const risk = primaryCity.dailyRisks[i];
        const dayNum = i + 1;
        const dayLabel = getDayLabel(dayNum);
        const dayDate = getDayDate(dayNum);

        let value: number | null = null;
        switch (metric) {
          case 'risk':
            value = risk?.score_display ?? null;
            break;
          case 'tempHigh':
            value = summary.tmax != null ? Math.round(summary.tmax) : null;
            break;
          case 'tempLow':
            value = summary.tmin != null ? Math.round(summary.tmin) : null;
            break;
          case 'rain':
            value = summary.rain_total ?? null;
            break;
          case 'snow':
            value = summary.snow_total ?? null;
            break;
          case 'windGust':
            value = summary.wind_gust_max != null ? Math.round(summary.wind_gust_max) : null;
            break;
        }

        return { day: dayNum, dayLabel, dayDate, value };
      });

      series.push({
        cityId: primaryCity.id,
        cityName: primaryCity.name,
        cityState: primaryCity.state,
        color: PRIMARY_COLORS[metric],
        isPrimary: true,
        data,
      });
    }

    // Comparison city series
    if (showCompare) {
      compareCityIds.forEach((cityId, index) => {
        const city = availableCities.find(c => c.cityId === cityId);
        if (!city || !city.dailySummary || !city.dailyRisks) return;

        const data: ChartSeriesPoint[] = city.dailySummary.map((summary, i) => {
          const risk = city.dailyRisks?.[i];
          const dayNum = i + 1;
          const dayLabel = getDayLabel(dayNum);
          const dayDate = getDayDate(dayNum);

          let value: number | null = null;
          switch (metric) {
            case 'risk':
              value = risk?.score_display ?? null;
              break;
            case 'tempHigh':
              value = summary.tmax != null ? Math.round(summary.tmax) : null;
              break;
            case 'tempLow':
              value = summary.tmin != null ? Math.round(summary.tmin) : null;
              break;
            case 'rain':
              value = summary.rain_total ?? null;
              break;
            case 'snow':
              value = summary.snow_total ?? null;
              break;
            case 'windGust':
              value = summary.wind_gust_max != null ? Math.round(summary.wind_gust_max) : null;
              break;
          }

          return { day: dayNum, dayLabel, dayDate, value };
        });

        series.push({
          cityId: city.cityId,
          cityName: city.name,
          cityState: city.state,
          color: COMPARE_COLORS[index % COMPARE_COLORS.length],
          isPrimary: false,
          data,
        });
      });
    }

    return series;
  }, [primaryCity, compareCityIds, showCompare, availableCities]);

  const value = useMemo(() => ({
    compareCityIds,
    addCompareCity,
    removeCompareCity,
    clearCompareCities,
    toggleCompareCity,
    maxCompareCities,
    getCompareColor,
    getPrimaryColor,
    showCompare,
    setShowCompare,
    availableCities,
    setAvailableCities,
    primaryCity,
    setPrimaryCity,
    getSeries,
    getCompareCity,
  }), [
    compareCityIds,
    addCompareCity,
    removeCompareCity,
    clearCompareCities,
    toggleCompareCity,
    getCompareColor,
    getPrimaryColor,
    showCompare,
    availableCities,
    primaryCity,
    getSeries,
    getCompareCity,
  ]);

  return (
    <ChartCompareContext.Provider value={value}>
      {children}
    </ChartCompareContext.Provider>
  );
}

export function useChartCompare() {
  const context = useContext(ChartCompareContext);
  if (!context) {
    throw new Error('useChartCompare must be used within a ChartCompareProvider');
  }
  return context;
}

// Helper functions for day labels
function getDayLabel(dayNum: number): string {
  if (dayNum === 1) return 'Today';
  if (dayNum === 2) return 'Tom';
  const date = new Date();
  date.setDate(date.getDate() + dayNum - 1);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function getDayDate(dayNum: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayNum - 1);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
