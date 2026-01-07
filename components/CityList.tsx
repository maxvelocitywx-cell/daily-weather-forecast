'use client';

import { CityMetricsSummary } from '@/lib/types';
import { RiskBadge } from './RiskBadge';
import { CityRiskSparkline } from './CityRiskChart';
import { ConditionBadge, ConditionType } from './WeatherIcons';
import { Snowflake, CloudRain, Wind } from 'lucide-react';
import clsx from 'clsx';
import { formatCityLabel } from '@/lib/formatCityLabel';
import { getCityDayRisk } from '@/lib/getCityDayRisk';

interface CityListProps {
  cities: CityMetricsSummary[];
  selectedDay: number;
  onCitySelect: (cityId: string) => void;
  selectedCityId?: string;
  compact?: boolean;
  showMetrics?: boolean;
}

export function CityList({
  cities,
  selectedDay,
  onCitySelect,
  selectedCityId,
  compact = false,
  showMetrics = true,
}: CityListProps) {
  const dayIndex = selectedDay - 1;

  // Sort by risk (highest first), missing scores go to bottom
  const sortedCities = [...cities].sort((a, b) => {
    const aResult = getCityDayRisk(a, dayIndex);
    const bResult = getCityDayRisk(b, dayIndex);
    // Missing scores go to bottom
    if (!aResult.hasData && !bResult.hasData) return 0;
    if (!aResult.hasData) return 1;
    if (!bResult.hasData) return -1;
    return (bResult.score ?? 0) - (aResult.score ?? 0);
  });

  if (compact) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {sortedCities.map((city) => {
          const riskResult = getCityDayRisk(city, dayIndex);

          return (
            <button
              key={city.id}
              onClick={() => onCitySelect(city.id)}
              className={clsx(
                'flex items-center justify-between p-2 rounded-lg transition-colors text-left',
                selectedCityId === city.id
                  ? 'bg-mv-accent-blue/20 border border-mv-accent-blue/30'
                  : 'bg-mv-bg-tertiary/50 hover:bg-mv-bg-tertiary border border-transparent'
              )}
            >
              <span className="text-sm text-mv-text-primary truncate">
                {formatCityLabel(city)}
              </span>
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
    );
  }

  return (
    <div className="space-y-2">
      {sortedCities.map((city) => {
        const riskResult = getCityDayRisk(city, dayIndex);
        const dayData = city.days[dayIndex];
        const condition = dayData?.condition || 'sunny';

        // Get daily metrics (need to access dailySummary if available)
        const snow = city.snow24h || 0;
        const rain = city.rain24h || 0;
        const wind = city.maxGust48h || 0;

        return (
          <button
            key={city.id}
            onClick={() => onCitySelect(city.id)}
            className={clsx(
              'w-full flex items-center justify-between p-3 rounded-lg transition-all text-left',
              selectedCityId === city.id
                ? 'bg-mv-accent-blue/20 border border-mv-accent-blue/30'
                : 'bg-mv-bg-secondary hover:bg-mv-bg-tertiary border border-white/5 hover:border-white/10'
            )}
          >
            <div className="flex items-center gap-3">
              {riskResult.hasData ? (
                <RiskBadge score={riskResult.score!} size="sm" />
              ) : (
                <span className="text-xs text-mv-text-muted px-2 py-1 bg-mv-bg-tertiary rounded">
                  N/A
                </span>
              )}
              <div>
                <div className="text-sm font-medium text-mv-text-primary">
                  {formatCityLabel(city)}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <ConditionBadge
                    condition={condition as ConditionType}
                    size="xs"
                    showLabel={true}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Metric badges - only show if non-zero */}
              {showMetrics && (
                <div className="flex items-center gap-2">
                  {snow > 0 && (
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400">
                      <Snowflake size={12} />
                      <span className="text-xs font-medium">{snow.toFixed(1)}"</span>
                    </div>
                  )}
                  {rain > 0 && (
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                      <CloudRain size={12} />
                      <span className="text-xs font-medium">{rain.toFixed(2)}"</span>
                    </div>
                  )}
                  {wind >= 30 && (
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400">
                      <Wind size={12} />
                      <span className="text-xs font-medium">{Math.round(wind)}</span>
                    </div>
                  )}
                </div>
              )}
              <CityRiskSparkline days={city.days} width={60} height={20} />
              <svg
                className="w-4 h-4 text-mv-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function CityListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between p-3 rounded-lg bg-mv-bg-secondary border border-white/5 animate-pulse"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-mv-bg-tertiary" />
            <div>
              <div className="h-4 w-24 bg-mv-bg-tertiary rounded" />
              <div className="h-3 w-16 bg-mv-bg-tertiary rounded mt-1" />
            </div>
          </div>
          <div className="w-16 h-5 bg-mv-bg-tertiary rounded" />
        </div>
      ))}
    </div>
  );
}
