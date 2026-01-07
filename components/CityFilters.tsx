'use client';

import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { ChevronDown, X, Filter, ArrowUpDown } from 'lucide-react';
import { CityMetricsSummary } from '@/lib/types';
import { getCityDayRisk } from '@/lib/getCityDayRisk';

export type SortOption =
  | 'risk-desc'
  | 'risk-asc'
  | 'temp-desc'
  | 'temp-asc'
  | 'rain-desc'
  | 'rain-asc'
  | 'snow-desc'
  | 'snow-asc';

export interface CityFiltersState {
  sort: SortOption;
  riskMin: number | null;
  riskMax: number | null;
  tempMin: number | null;
  tempMax: number | null;
  rainThreshold: number | null;
  snowThreshold: number | null;
  onlySPC: boolean;
  onlyERO: boolean;
  onlyWinter: boolean;
}

const defaultFilters: CityFiltersState = {
  sort: 'risk-desc',
  riskMin: null,
  riskMax: null,
  tempMin: null,
  tempMax: null,
  rainThreshold: null,
  snowThreshold: null,
  onlySPC: false,
  onlyERO: false,
  onlyWinter: false,
};

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'risk-desc', label: 'Risk (High → Low)' },
  { value: 'risk-asc', label: 'Risk (Low → High)' },
  { value: 'temp-desc', label: 'Temp (High → Low)' },
  { value: 'temp-asc', label: 'Temp (Low → High)' },
  { value: 'rain-desc', label: 'Rain (High → Low)' },
  { value: 'rain-asc', label: 'Rain (Low → High)' },
  { value: 'snow-desc', label: 'Snow (High → Low)' },
  { value: 'snow-asc', label: 'Snow (Low → High)' },
];

const RAIN_THRESHOLDS = [
  { value: 0.1, label: '≥ 0.10"' },
  { value: 0.25, label: '≥ 0.25"' },
  { value: 0.5, label: '≥ 0.50"' },
  { value: 1.0, label: '≥ 1.00"' },
];

const SNOW_THRESHOLDS = [
  { value: 1, label: '≥ 1"' },
  { value: 3, label: '≥ 3"' },
  { value: 6, label: '≥ 6"' },
  { value: 12, label: '≥ 12"' },
];

interface CityFiltersProps {
  filters: CityFiltersState;
  onFiltersChange: (filters: CityFiltersState) => void;
  totalCount: number;
  filteredCount: number;
  compact?: boolean;
}

export function CityFilters({
  filters,
  onFiltersChange,
  totalCount,
  filteredCount,
  compact = false,
}: CityFiltersProps) {
  const [showFilters, setShowFilters] = useState(false);

  const hasActiveFilters = useMemo(() => {
    return (
      filters.riskMin !== null ||
      filters.riskMax !== null ||
      filters.tempMin !== null ||
      filters.tempMax !== null ||
      filters.rainThreshold !== null ||
      filters.snowThreshold !== null ||
      filters.onlySPC ||
      filters.onlyERO ||
      filters.onlyWinter
    );
  }, [filters]);

  const clearFilters = () => {
    onFiltersChange({ ...defaultFilters, sort: filters.sort });
  };

  const updateFilter = <K extends keyof CityFiltersState>(
    key: K,
    value: CityFiltersState[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className="space-y-2">
      {/* Controls bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Sort dropdown */}
        <div className="relative">
          <select
            value={filters.sort}
            onChange={(e) => updateFilter('sort', e.target.value as SortOption)}
            className="appearance-none bg-mv-bg-tertiary border border-white/10 rounded-lg px-3 py-1.5 pr-8 text-xs text-mv-text-primary focus:outline-none focus:ring-2 focus:ring-mv-accent-blue/50"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ArrowUpDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-mv-text-muted pointer-events-none" />
        </div>

        {/* Filter toggle */}
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors',
            hasActiveFilters
              ? 'bg-mv-accent-blue/20 text-mv-accent-blue border border-mv-accent-blue/30'
              : 'bg-mv-bg-tertiary border border-white/10 text-mv-text-muted hover:text-mv-text-primary'
          )}
        >
          <Filter className="w-3 h-3" />
          Filters
          {hasActiveFilters && (
            <span className="bg-mv-accent-blue text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
              !
            </span>
          )}
        </button>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-mv-text-muted hover:text-mv-text-primary transition-colors"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}

        {/* Count display */}
        <div className="ml-auto text-xs text-mv-text-muted">
          Showing {filteredCount} of {totalCount}
        </div>
      </div>

      {/* Expanded filters panel */}
      {showFilters && (
        <div className="bg-mv-bg-tertiary/50 rounded-lg p-3 border border-white/5 space-y-3">
          {/* Quick toggles */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => updateFilter('onlySPC', !filters.onlySPC)}
              className={clsx(
                'px-2 py-1 rounded text-xs transition-colors',
                filters.onlySPC
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                  : 'bg-mv-bg-secondary border border-white/10 text-mv-text-muted hover:text-mv-text-primary'
              )}
            >
              SPC Risk (MRGL+)
            </button>
            <button
              type="button"
              onClick={() => updateFilter('onlyERO', !filters.onlyERO)}
              className={clsx(
                'px-2 py-1 rounded text-xs transition-colors',
                filters.onlyERO
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-mv-bg-secondary border border-white/10 text-mv-text-muted hover:text-mv-text-primary'
              )}
            >
              WPC ERO (MRGL+)
            </button>
            <button
              type="button"
              onClick={() => updateFilter('onlyWinter', !filters.onlyWinter)}
              className={clsx(
                'px-2 py-1 rounded text-xs transition-colors',
                filters.onlyWinter
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'bg-mv-bg-secondary border border-white/10 text-mv-text-muted hover:text-mv-text-primary'
              )}
            >
              Winter Impacts
            </button>
          </div>

          {/* Threshold filters */}
          <div className="grid grid-cols-2 gap-3">
            {/* Rain threshold */}
            <div>
              <label className="text-[10px] text-mv-text-muted uppercase tracking-wide mb-1 block">
                Rain
              </label>
              <div className="flex flex-wrap gap-1">
                {RAIN_THRESHOLDS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() =>
                      updateFilter(
                        'rainThreshold',
                        filters.rainThreshold === t.value ? null : t.value
                      )
                    }
                    className={clsx(
                      'px-2 py-0.5 rounded text-[10px] transition-colors',
                      filters.rainThreshold === t.value
                        ? 'bg-blue-500/30 text-blue-300 border border-blue-500/40'
                        : 'bg-mv-bg-secondary border border-white/10 text-mv-text-muted'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Snow threshold */}
            <div>
              <label className="text-[10px] text-mv-text-muted uppercase tracking-wide mb-1 block">
                Snow
              </label>
              <div className="flex flex-wrap gap-1">
                {SNOW_THRESHOLDS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() =>
                      updateFilter(
                        'snowThreshold',
                        filters.snowThreshold === t.value ? null : t.value
                      )
                    }
                    className={clsx(
                      'px-2 py-0.5 rounded text-[10px] transition-colors',
                      filters.snowThreshold === t.value
                        ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/40'
                        : 'bg-mv-bg-secondary border border-white/10 text-mv-text-muted'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Risk range */}
          <div>
            <label className="text-[10px] text-mv-text-muted uppercase tracking-wide mb-1 block">
              Risk Score Range
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="10"
                step="0.1"
                placeholder="Min"
                value={filters.riskMin ?? ''}
                onChange={(e) =>
                  updateFilter(
                    'riskMin',
                    e.target.value ? parseFloat(e.target.value) : null
                  )
                }
                className="w-16 bg-mv-bg-secondary border border-white/10 rounded px-2 py-1 text-xs text-mv-text-primary focus:outline-none focus:ring-1 focus:ring-mv-accent-blue/50"
              />
              <span className="text-mv-text-muted text-xs">to</span>
              <input
                type="number"
                min="1"
                max="10"
                step="0.1"
                placeholder="Max"
                value={filters.riskMax ?? ''}
                onChange={(e) =>
                  updateFilter(
                    'riskMax',
                    e.target.value ? parseFloat(e.target.value) : null
                  )
                }
                className="w-16 bg-mv-bg-secondary border border-white/10 rounded px-2 py-1 text-xs text-mv-text-primary focus:outline-none focus:ring-1 focus:ring-mv-accent-blue/50"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Apply filters and sorting to a list of cities
 * Uses getCityDayRisk for canonical risk lookups
 * Missing scores are pushed to the bottom regardless of sort direction
 */
export function filterAndSortCities(
  cities: CityMetricsSummary[],
  selectedDay: number,
  filters: CityFiltersState
): CityMetricsSummary[] {
  const dayIndex = selectedDay - 1;

  // Filter
  let filtered = cities.filter((city) => {
    const riskResult = getCityDayRisk(city, dayIndex);
    const dailySummary = city.dailySummary?.[dayIndex];
    const dailyRisk = city.dailyRisks?.[dayIndex];

    // If risk data is missing, only include if no risk filters are active
    if (!riskResult.hasData) {
      // Exclude from filtered results if risk filters are applied
      if (filters.riskMin !== null || filters.riskMax !== null) return false;
    }

    const risk = riskResult.score;
    const rain = dailySummary?.rain_total ?? 0;
    const snow = dailySummary?.snow_total ?? 0;
    const spcCategory = dailyRisk?.overlay?.spc_category;
    const eroCategory = dailyRisk?.overlay?.ero_category;

    // Risk range filter (only apply if we have risk data)
    if (risk !== null) {
      if (filters.riskMin !== null && risk < filters.riskMin) return false;
      if (filters.riskMax !== null && risk > filters.riskMax) return false;
    }

    // Rain threshold
    if (filters.rainThreshold !== null && rain < filters.rainThreshold)
      return false;

    // Snow threshold
    if (filters.snowThreshold !== null && snow < filters.snowThreshold)
      return false;

    // SPC filter (MRGL or higher)
    if (filters.onlySPC) {
      const validSPC = ['MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'];
      if (!spcCategory || !validSPC.includes(spcCategory)) return false;
    }

    // ERO filter (MRGL or higher)
    if (filters.onlyERO) {
      const validERO = ['MRGL', 'SLGT', 'MDT', 'HIGH'];
      if (!eroCategory || !validERO.includes(eroCategory)) return false;
    }

    // Winter impacts filter
    if (filters.onlyWinter) {
      if (snow <= 0) return false;
    }

    return true;
  });

  // Sort - missing values go to bottom for all sort types
  filtered.sort((a, b) => {
    const aRiskResult = getCityDayRisk(a, dayIndex);
    const bRiskResult = getCityDayRisk(b, dayIndex);
    const aDailySummary = a.dailySummary?.[dayIndex];
    const bDailySummary = b.dailySummary?.[dayIndex];

    const aTemp = aDailySummary?.tmax ?? null;
    const bTemp = bDailySummary?.tmax ?? null;
    const aRain = aDailySummary?.rain_total ?? null;
    const bRain = bDailySummary?.rain_total ?? null;
    const aSnow = aDailySummary?.snow_total ?? null;
    const bSnow = bDailySummary?.snow_total ?? null;

    // Helper to handle missing values - always push to bottom
    const compareWithNull = (
      aVal: number | null,
      bVal: number | null,
      desc: boolean
    ): number => {
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1; // a goes to bottom
      if (bVal === null) return -1; // b goes to bottom
      return desc ? bVal - aVal : aVal - bVal;
    };

    switch (filters.sort) {
      case 'risk-desc':
        return compareWithNull(aRiskResult.score, bRiskResult.score, true);
      case 'risk-asc':
        return compareWithNull(aRiskResult.score, bRiskResult.score, false);
      case 'temp-desc':
        return compareWithNull(aTemp, bTemp, true);
      case 'temp-asc':
        return compareWithNull(aTemp, bTemp, false);
      case 'rain-desc':
        return compareWithNull(aRain, bRain, true);
      case 'rain-asc':
        return compareWithNull(aRain, bRain, false);
      case 'snow-desc':
        return compareWithNull(aSnow, bSnow, true);
      case 'snow-asc':
        return compareWithNull(aSnow, bSnow, false);
      default:
        return compareWithNull(aRiskResult.score, bRiskResult.score, true);
    }
  });

  return filtered;
}

export { defaultFilters };
