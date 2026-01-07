'use client';

import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { RegionId, RegionRiskData, CityMetricsSummary, DayExplainPayload } from '@/lib/types';
import { REGIONS } from '@/lib/regions';
import { RiskBadge } from './RiskBadge';
import { OverlayBadges } from './OverlayBadge';
import { useOverlays } from '@/lib/overlays/useOverlays';
import { formatDayLabel } from '@/lib/formatDayLabel';
import { formatCityLabel } from '@/lib/formatCityLabel';
import { getCityDayRisk } from '@/lib/getCityDayRisk';
import { WhyThisScore } from './WhyThisScore';
import {
  CityFilters,
  CityFiltersState,
  filterAndSortCities,
  defaultFilters,
} from './CityFilters';

interface RegionCardProps {
  regionId: RegionId;
  riskData: RegionRiskData;
  cities: CityMetricsSummary[];
  selectedDay: number;
  isExpanded: boolean;
  onToggle: () => void;
  onCitySelect: (cityId: string) => void;
}

export function RegionCard({
  regionId,
  riskData,
  cities,
  selectedDay,
  isExpanded,
  onToggle,
  onCitySelect,
}: RegionCardProps) {
  const [showAllCities, setShowAllCities] = useState(false);
  const [filters, setFilters] = useState<CityFiltersState>(defaultFilters);
  const region = REGIONS[regionId];
  const { spcData, eroData, overlaysEnabled } = useOverlays();

  // Apply filters and sorting
  const filteredCities = useMemo(() => {
    return filterAndSortCities(cities, selectedDay, filters);
  }, [cities, selectedDay, filters]);

  // For initial view (not expanded), just show top 6 by risk
  // Missing scores are pushed to bottom
  const sortedCitiesForPreview = useMemo(() => {
    const dayIndex = selectedDay - 1;
    return [...cities].sort((a, b) => {
      const aResult = getCityDayRisk(a, dayIndex);
      const bResult = getCityDayRisk(b, dayIndex);
      // Missing scores go to bottom
      if (!aResult.hasData && !bResult.hasData) return 0;
      if (!aResult.hasData) return 1;
      if (!bResult.hasData) return -1;
      return (bResult.score ?? 0) - (aResult.score ?? 0);
    });
  }, [cities, selectedDay]);

  if (!region) return null;

  // Get current day's risk and explain data
  const dayKey = `day${selectedDay}` as keyof RegionRiskData;
  const dayData = riskData[dayKey];
  const risk = typeof dayData === 'object' && dayData && 'risk' in dayData
    ? (dayData as { risk: number }).risk
    : 3;
  const conditions = typeof dayData === 'object' && dayData && 'conditions' in dayData
    ? (dayData as { conditions: string }).conditions
    : 'Typical conditions';
  const explain = typeof dayData === 'object' && dayData && 'explain' in dayData
    ? (dayData as { explain: DayExplainPayload }).explain
    : null;

  // Get SPC/ERO for this day
  const spcDayKey = `day${selectedDay}` as 'day1' | 'day2' | 'day3';
  const spc = spcData?.[spcDayKey];
  const ero = eroData?.[spcDayKey];

  // Determine which cities to display
  const displayCities = showAllCities ? filteredCities : sortedCitiesForPreview.slice(0, 6);

  return (
    <div
      className={clsx(
        'bg-mv-bg-secondary rounded-xl border transition-all duration-200',
        isExpanded
          ? 'border-mv-accent-blue/30 shadow-lg shadow-mv-accent-blue/5'
          : 'border-white/5 hover:border-white/10'
      )}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <RiskBadge score={risk} size="md" showLabel />
            {/* WhyThisScore is outside the button to avoid nested buttons */}
            <WhyThisScore explain={explain} score={risk} compact position="bottom" />
          </div>
          <button
            onClick={onToggle}
            className="text-left flex-1"
          >
            <h3 className="text-lg font-semibold text-mv-text-primary">
              {region.name}
            </h3>
            <p className="text-sm text-mv-text-muted mt-0.5 line-clamp-1">
              {conditions}
            </p>
          </button>
        </div>

        <button
          onClick={onToggle}
          className="flex items-center gap-3"
        >
          {overlaysEnabled && (
            <OverlayBadges spc={spc} ero={ero} size="sm" />
          )}
          <svg
            className={clsx(
              'w-5 h-5 text-mv-text-muted transition-transform duration-200',
              isExpanded && 'rotate-180'
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-white/5">
          {/* 3-day overview */}
          <div className="flex items-center gap-2 py-3 border-b border-white/5">
            {[1, 2, 3].map((day) => {
              const dKey = `day${day}` as keyof RegionRiskData;
              const dData = riskData[dKey];
              const dRisk = typeof dData === 'object' && dData && 'risk' in dData
                ? (dData as { risk: number }).risk
                : 3;

              return (
                <div
                  key={day}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg',
                    day === selectedDay
                      ? 'bg-mv-accent-blue/10 border border-mv-accent-blue/20'
                      : 'bg-mv-bg-tertiary/50'
                  )}
                >
                  <span className="text-xs text-mv-text-muted">
                    {formatDayLabel(day)}
                  </span>
                  <RiskBadge score={dRisk} size="xs" />
                </div>
              );
            })}
          </div>

          {/* Cities list */}
          <div className="mt-3">
            {/* Show filters when viewing all cities */}
            {showAllCities ? (
              <div className="mb-3">
                <CityFilters
                  filters={filters}
                  onFiltersChange={setFilters}
                  totalCount={cities.length}
                  filteredCount={filteredCities.length}
                />
              </div>
            ) : (
              <div className="text-xs text-mv-text-muted mb-2">
                Cities ({cities.length})
              </div>
            )}

            <div className={clsx(
              'grid grid-cols-2 gap-2',
              showAllCities && 'max-h-96 overflow-y-auto pr-1'
            )}>
              {displayCities.map((city) => {
                const riskResult = getCityDayRisk(city, selectedDay - 1);
                const dailySummary = city.dailySummary?.[selectedDay - 1];

                return (
                  <button
                    key={city.id}
                    onClick={() => onCitySelect(city.id)}
                    className="flex items-center justify-between p-2 rounded-lg bg-mv-bg-tertiary/50 hover:bg-mv-bg-tertiary transition-colors text-left group"
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <span className="text-sm text-mv-text-primary truncate block">
                        {formatCityLabel(city)}
                      </span>
                      {/* Show additional info when viewing all */}
                      {showAllCities && dailySummary && (
                        <span className="text-[10px] text-mv-text-muted">
                          {dailySummary.tmax ? `${Math.round(dailySummary.tmax)}°` : ''}
                          {dailySummary.snow_total > 0 && ` · ${dailySummary.snow_total.toFixed(1)}" snow`}
                          {dailySummary.rain_total > 0.1 && ` · ${dailySummary.rain_total.toFixed(2)}" rain`}
                        </span>
                      )}
                    </div>
                    {riskResult.hasData ? (
                      <RiskBadge score={riskResult.score!} size="xs" />
                    ) : (
                      <span className="text-xs text-mv-text-muted px-1.5 py-0.5 bg-mv-bg-secondary rounded">
                        N/A
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Show all / show fewer toggle */}
            {cities.length > 6 && (
              <div className="mt-2 text-center">
                <button
                  type="button"
                  onClick={() => setShowAllCities(!showAllCities)}
                  className="text-xs text-mv-accent-blue hover:underline focus:outline-none focus:ring-2 focus:ring-mv-accent-blue/50 rounded px-2 py-1"
                >
                  {showAllCities ? 'Show fewer cities' : `View all ${cities.length} cities`}
                </button>
              </div>
            )}

            {/* No results message */}
            {showAllCities && filteredCities.length === 0 && (
              <div className="text-center py-4 text-sm text-mv-text-muted">
                No cities match your filters
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RegionCardSkeleton() {
  return (
    <div className="bg-mv-bg-secondary rounded-xl border border-white/5 p-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-mv-bg-tertiary" />
        <div className="flex-1">
          <div className="h-5 w-32 bg-mv-bg-tertiary rounded" />
          <div className="h-4 w-48 bg-mv-bg-tertiary rounded mt-2" />
        </div>
      </div>
    </div>
  );
}
