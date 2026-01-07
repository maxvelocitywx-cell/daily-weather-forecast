'use client';

import { useEffect, useState, useMemo } from 'react';
import clsx from 'clsx';
import { BarChart3 } from 'lucide-react';
import { CityDetailForecast, CityDayForecast, CityMetricsSummary, DayExplainPayload } from '@/lib/types';
import { useCityForecast, useRegionCities } from '@/hooks/useWeather';
import { RiskBadge } from './RiskBadge';
import { RiskExplainer } from './RiskExplainer';
import { WhyThisScore } from './WhyThisScore';
import { CityRiskChart } from './CityRiskChart';
import { CityChartsModal } from './CityChartsModal';
import {
  EnhancedTempSparkline,
  EnhancedPrecipSparkline,
  EnhancedWindSparkline,
} from './EnhancedSparkline';
import { CompactDaySelector } from './RegionDaySelector';
import { formatDayLabel } from '@/lib/formatDayLabel';
import { formatCityLabel } from '@/lib/formatCityLabel';

interface CityDrawerProps {
  cityId: string | null;
  onClose: () => void;
  initialDay?: number;
}

export function CityDrawer({ cityId, onClose, initialDay = 1 }: CityDrawerProps) {
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [chartsModalOpen, setChartsModalOpen] = useState(false);
  const { city: cityData, isLoading, error } = useCityForecast(cityId || '');
  const { data: allCitiesData } = useRegionCities();

  // Find the canonical city data from regions API (single source of truth for cityRisk)
  const canonicalCityData = useMemo(() => {
    if (!cityId || !allCitiesData) return null;
    return allCitiesData.find((c: CityMetricsSummary) => c.cityId === cityId || c.id === cityId);
  }, [cityId, allCitiesData]);

  // Transform API response to the expected days format with explain data
  // CRITICAL: Use canonical cityRisk from regions API (city.days[].risk), not recomputed values
  const days: (CityDayForecast & { explain?: DayExplainPayload })[] = useMemo(() => {
    if (!cityData) return [];
    const data = cityData as CityDetailForecast;

    return (data.dailyRisks || []).map((risk, i) => {
      const summary = data.dailySummary?.[i];

      // Use canonical risk from regions API's days array (same source as RegionCard)
      // This ensures list view and detail view show the exact same cityRisk
      // Fallback chain: canonical days.risk -> canonical dailyRisks.score_display -> city API
      const canonicalDayRisk = canonicalCityData?.days?.[i]?.risk;
      const canonicalDailyRisk = canonicalCityData?.dailyRisks?.[i]?.score_display;
      const cityApiRisk = risk.score_display;

      // Determine which source we're using
      let displayRisk: number;
      if (canonicalDayRisk !== undefined && canonicalDayRisk !== null) {
        displayRisk = canonicalDayRisk;
      } else if (canonicalDailyRisk !== undefined && canonicalDailyRisk !== null) {
        displayRisk = canonicalDailyRisk;
      } else if (cityApiRisk !== undefined && cityApiRisk !== null) {
        displayRisk = cityApiRisk;
      } else {
        // No data available - log error in dev and use fallback
        if (process.env.NODE_ENV === 'development') {
          console.error(`[CityDrawer] No risk data for ${cityId} day ${i + 1}. ` +
            `canonicalDayRisk=${canonicalDayRisk}, canonicalDailyRisk=${canonicalDailyRisk}, cityApiRisk=${cityApiRisk}`);
        }
        displayRisk = -1; // Sentinel value to indicate missing data
      }

      // For explain data, use canonical if available
      const canonicalExplain = canonicalCityData?.dailyRisks?.[i]?.explain;
      const explainData = canonicalExplain ?? risk.explain;

      return {
        risk: displayRisk,
        tempHigh: summary?.tmax || 70,
        tempLow: summary?.tmin || 50,
        precipTotal: (summary?.rain_total || 0) + (summary?.snow_total || 0),
        precipChance: summary?.rain_total > 0 ? 80 : summary?.snow_total > 0 ? 70 : 20,
        windGust: summary?.wind_gust_max || 0,
        condition: summary?.conditions?.primary || 'Fair',
        explain: explainData,
        risks: explainData ? {
          snow: explainData.top_drivers?.find((d: { hazard: string; score?: number }) => d.hazard === 'Snow')?.score,
          rain: explainData.top_drivers?.find((d: { hazard: string; score?: number }) => d.hazard === 'Rain')?.score,
          wind: explainData.top_drivers?.find((d: { hazard: string; score?: number }) => d.hazard === 'Wind')?.score,
        } : undefined,
      };
    });
  }, [cityData, canonicalCityData, cityId]);

  // Transform hourly data
  const hourlyData = useMemo(() => {
    if (!cityData) return { temperature: [], precipitation: [], windGusts: [] };
    const data = cityData as CityDetailForecast;
    return {
      temperature: (data.hourly || []).map(h => h.temperature),
      precipitation: (data.hourly || []).map(h => h.precipitation),
      windGusts: (data.hourly || []).map(h => h.windGust),
    };
  }, [cityData]);

  // Get cities from same region for comparison
  const compareCities = useMemo(() => {
    if (!cityData || !allCitiesData) return [];
    const data = cityData as CityDetailForecast;
    return allCitiesData.filter(
      (c: CityMetricsSummary) =>
        c.regionId === data.regionId &&
        c.cityId !== data.city?.id &&
        c.dailySummary &&
        c.dailySummary.length > 0
    );
  }, [cityData, allCitiesData]);

  // Reset selected day when city changes - use initialDay from parent
  useEffect(() => {
    setSelectedDay(initialDay);
  }, [cityId, initialDay]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (cityId) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [cityId, onClose]);

  if (!cityId) return null;

  const isOpen = !!cityId;

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          'fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* Centered Modal Container */}
      <div
        className={clsx(
          'fixed inset-0 z-50 overflow-y-auto transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        {/* Centering wrapper with padding for all screen sizes */}
        <div className="flex min-h-full justify-center px-4 py-6 sm:py-8">
          {/* Modal panel - centered with max-width matching page layout (max-w-7xl = 80rem, using ~900px for modal) */}
          <div
            className={clsx(
              'w-full max-w-3xl bg-mv-bg-primary rounded-xl border border-white/10 shadow-2xl transition-all duration-300 h-fit',
              isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
            )}
          >
            {/* Header */}
            <div className="sticky top-0 bg-mv-bg-primary/95 backdrop-blur-sm border-b border-white/10 p-4 sm:p-6 rounded-t-xl z-10">
              <div className="flex items-center justify-between">
                <div>
                  {isLoading ? (
                    <div className="h-6 w-32 bg-mv-bg-tertiary rounded animate-pulse" />
                  ) : (
                    <h2 className="text-xl sm:text-2xl font-semibold text-mv-text-primary">
                      {(cityData as CityDetailForecast)?.city
                        ? formatCityLabel((cityData as CityDetailForecast).city)
                        : 'Loading...'}
                    </h2>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                  aria-label="Close city details"
                >
                  <svg
                    className="w-6 h-6 text-mv-text-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-6 space-y-6">
              {isLoading ? (
                <CityDrawerSkeleton />
              ) : error ? (
                <div className="text-center py-8 text-mv-text-muted">
                  Failed to load city data
                </div>
              ) : days.length > 0 ? (
                <>
                  {/* 7-Day Risk Overview */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-mv-text-muted">
                        7-Day Risk Outlook
                      </h3>
                      <button
                        onClick={() => setChartsModalOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mv-accent/20 text-mv-accent hover:bg-mv-accent/30 transition-colors text-sm font-medium"
                      >
                        <BarChart3 className="w-4 h-4" />
                        Open Charts
                      </button>
                    </div>
                    <div className="bg-mv-bg-secondary rounded-xl p-4 border border-white/5">
                      <CityRiskChart days={days} />
                    </div>
                  </section>

                  {/* Day Selector */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-mv-text-muted">
                        Day Details
                      </h3>
                      <CompactDaySelector
                        selectedDay={selectedDay}
                        onDayChange={setSelectedDay}
                        maxDays={Math.min(days.length, 7)}
                      />
                    </div>

                    {days[selectedDay - 1] && (
                      <DayDetails day={days[selectedDay - 1]} dayIndex={selectedDay} />
                    )}
                  </section>

                  {/* Hourly Charts */}
                  <section>
                    <h3 className="text-sm font-medium text-mv-text-muted mb-3">
                      Hourly Forecast
                    </h3>
                    <div className="space-y-4">
                      {/* Temperature */}
                      <div className="bg-mv-bg-secondary rounded-xl p-4 border border-white/5">
                        <div className="text-xs text-mv-text-muted mb-2">
                          Temperature (°F)
                        </div>
                        <EnhancedTempSparkline
                          temps={hourlyData.temperature}
                          height={60}
                        />
                      </div>

                      {/* Precipitation */}
                      <div className="bg-mv-bg-secondary rounded-xl p-4 border border-white/5">
                        <div className="text-xs text-mv-text-muted mb-2">
                          Precipitation (in)
                        </div>
                        <EnhancedPrecipSparkline
                          precip={hourlyData.precipitation}
                          height={60}
                        />
                      </div>

                      {/* Wind */}
                      <div className="bg-mv-bg-secondary rounded-xl p-4 border border-white/5">
                        <div className="text-xs text-mv-text-muted mb-2">
                          Wind Gusts (mph)
                        </div>
                        <EnhancedWindSparkline
                          gusts={hourlyData.windGusts}
                          height={60}
                        />
                      </div>
                    </div>
                  </section>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Charts Modal */}
      {cityData && (cityData as CityDetailForecast).dailySummary && (
        <CityChartsModal
          isOpen={chartsModalOpen}
          onClose={() => setChartsModalOpen(false)}
          cityName={(cityData as CityDetailForecast).city?.name || ''}
          cityState={(cityData as CityDetailForecast).city?.state || ''}
          regionId={(cityData as CityDetailForecast).regionId}
          dailySummary={(cityData as CityDetailForecast).dailySummary || []}
          dailyRisks={(cityData as CityDetailForecast).dailyRisks || []}
          selectedDay={selectedDay}
          onDayChange={setSelectedDay}
          compareCities={compareCities}
        />
      )}
    </>
  );
}

function DayDetails({
  day,
  dayIndex,
}: {
  day: CityDayForecast & { explain?: DayExplainPayload };
  dayIndex: number;
}) {
  return (
    <div className="bg-mv-bg-secondary rounded-xl p-4 border border-white/5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-mv-text-primary">
            {formatDayLabel(dayIndex)}
          </div>
          <div className="text-sm text-mv-text-muted">{day.condition}</div>
        </div>
        <div className="flex items-center gap-2">
          <RiskBadge score={day.risk} size="lg" showLabel />
          <WhyThisScore explain={day.explain} score={day.risk} position="left" />
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          label="High"
          value={`${Math.round(day.tempHigh)}°`}
          subValue={`Low: ${Math.round(day.tempLow)}°`}
          color="orange"
        />
        <MetricCard
          label="Precip"
          value={`${day.precipTotal.toFixed(2)}"`}
          subValue={`${Math.round(day.precipChance)}% chance`}
          color="blue"
        />
        <MetricCard
          label="Wind"
          value={`${Math.round(day.windGust)} mph`}
          subValue="max gust"
          color="yellow"
        />
      </div>

      {/* Risk breakdown */}
      {day.risks && (
        <div>
          <div className="text-xs text-mv-text-muted mb-2">Risk Breakdown</div>
          <RiskExplainer risks={day.risks} />
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subValue,
  color,
}: {
  label: string;
  value: string;
  subValue: string;
  color: 'orange' | 'blue' | 'yellow';
}) {
  const colorClasses = {
    orange: 'text-orange-400',
    blue: 'text-blue-400',
    yellow: 'text-yellow-400',
  };

  return (
    <div className="bg-mv-bg-tertiary/50 rounded-lg p-3">
      <div className="text-xs text-mv-text-muted mb-1">{label}</div>
      <div className={clsx('text-lg font-semibold', colorClasses[color])}>
        {value}
      </div>
      <div className="text-xs text-mv-text-muted">{subValue}</div>
    </div>
  );
}

function CityDrawerSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="bg-mv-bg-secondary rounded-xl p-4 border border-white/5">
        <div className="h-32 bg-mv-bg-tertiary rounded" />
      </div>
      <div className="bg-mv-bg-secondary rounded-xl p-4 border border-white/5">
        <div className="h-24 bg-mv-bg-tertiary rounded" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-mv-bg-secondary rounded-xl p-4 border border-white/5"
          >
            <div className="h-16 bg-mv-bg-tertiary rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
