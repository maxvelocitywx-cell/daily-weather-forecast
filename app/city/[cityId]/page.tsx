'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { CityDetailForecast, CityDayForecast, CityMetricsSummary, DayExplainPayload } from '@/lib/types';
import { useCityForecast, useRegionCities } from '@/hooks/useWeather';
import { RiskBadge } from '@/components/RiskBadge';
import { RiskExplainer } from '@/components/RiskExplainer';
import { WhyThisScore } from '@/components/WhyThisScore';
import { CityRiskChart } from '@/components/CityRiskChart';
import { CityChartsModal } from '@/components/CityChartsModal';
import {
  EnhancedTempSparkline,
  EnhancedPrecipSparkline,
  EnhancedWindSparkline,
} from '@/components/EnhancedSparkline';
import { CompactDaySelector } from '@/components/RegionDaySelector';
import { Header, Footer } from '@/components/UpdateBar';
import { formatDayLabel } from '@/lib/formatDayLabel';
import { formatCityLabel } from '@/lib/formatCityLabel';
import clsx from 'clsx';

export default function CityDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const cityId = params.cityId as string;
  const dayParam = searchParams.get('day');

  // Parse day from query param (day1, day2, etc.) or default to 1
  const initialDay = useMemo(() => {
    if (!dayParam) return 1;
    const match = dayParam.match(/^day(\d)$/);
    return match ? parseInt(match[1], 10) : 1;
  }, [dayParam]);

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
  const days: (CityDayForecast & { explain?: DayExplainPayload })[] = useMemo(() => {
    if (!cityData) return [];
    const data = cityData as CityDetailForecast;

    return (data.dailyRisks || []).map((risk, i) => {
      const summary = data.dailySummary?.[i];

      // Use canonical risk from regions API's days array
      const canonicalDayRisk = canonicalCityData?.days?.[i]?.risk;
      const canonicalDailyRisk = canonicalCityData?.dailyRisks?.[i]?.score_display;
      const cityApiRisk = risk.score_display;

      let displayRisk: number;
      if (canonicalDayRisk !== undefined && canonicalDayRisk !== null) {
        displayRisk = canonicalDayRisk;
      } else if (canonicalDailyRisk !== undefined && canonicalDailyRisk !== null) {
        displayRisk = canonicalDailyRisk;
      } else if (cityApiRisk !== undefined && cityApiRisk !== null) {
        displayRisk = cityApiRisk;
      } else {
        displayRisk = -1; // Sentinel for missing data
      }

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
  }, [cityData, canonicalCityData]);

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

  // Update URL when day changes
  useEffect(() => {
    const newDayKey = `day${selectedDay}`;
    const currentDayKey = searchParams.get('day');
    if (newDayKey !== currentDayKey) {
      router.replace(`/city/${cityId}?day=${newDayKey}`, { scroll: false });
    }
  }, [selectedDay, cityId, router, searchParams]);

  // Handle back navigation
  const handleBack = () => {
    router.back();
  };

  if (!cityId) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-mv-text-muted">City not found</div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-mv-bg-primary">
      <Header />

      {/* Back navigation */}
      <div className="max-w-4xl mx-auto px-4 pt-4 w-full">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-mv-text-muted hover:text-mv-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back to Map</span>
        </button>
      </div>

      <main className="flex-1 max-w-4xl mx-auto px-4 py-6 w-full">
        {/* Header */}
        <div className="mb-6">
          {isLoading ? (
            <div className="h-8 w-48 bg-mv-bg-tertiary rounded animate-pulse" />
          ) : (
            <h1 className="text-2xl sm:text-3xl font-bold text-mv-text-primary">
              {(cityData as CityDetailForecast)?.city
                ? formatCityLabel((cityData as CityDetailForecast).city)
                : 'Loading...'}
            </h1>
          )}
        </div>

        {isLoading ? (
          <CityDetailSkeleton />
        ) : error ? (
          <div className="text-center py-8 text-mv-text-muted bg-mv-bg-secondary rounded-xl border border-white/5">
            Failed to load city data. Please try again.
          </div>
        ) : days.length > 0 ? (
          <div className="space-y-6">
            {/* 7-Day Risk Overview */}
            <section className="bg-mv-bg-secondary rounded-xl p-4 sm:p-6 border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-mv-text-primary">
                  7-Day Risk Outlook
                </h2>
                <button
                  onClick={() => setChartsModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mv-accent/20 text-mv-accent hover:bg-mv-accent/30 transition-colors text-sm font-medium"
                >
                  <BarChart3 className="w-4 h-4" />
                  Charts
                </button>
              </div>
              <CityRiskChart days={days} />
            </section>

            {/* Day Selector */}
            <section className="bg-mv-bg-secondary rounded-xl p-4 sm:p-6 border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-mv-text-primary">
                  Day Details
                </h2>
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
            <section className="bg-mv-bg-secondary rounded-xl p-4 sm:p-6 border border-white/5">
              <h2 className="text-lg font-semibold text-mv-text-primary mb-4">
                Hourly Forecast
              </h2>
              <div className="space-y-4">
                {/* Temperature */}
                <div className="bg-mv-bg-tertiary/50 rounded-lg p-4">
                  <div className="text-xs text-mv-text-muted mb-2">
                    Temperature (°F)
                  </div>
                  <EnhancedTempSparkline
                    temps={hourlyData.temperature}
                    height={80}
                  />
                </div>

                {/* Precipitation */}
                <div className="bg-mv-bg-tertiary/50 rounded-lg p-4">
                  <div className="text-xs text-mv-text-muted mb-2">
                    Precipitation (in)
                  </div>
                  <EnhancedPrecipSparkline
                    precip={hourlyData.precipitation}
                    height={80}
                  />
                </div>

                {/* Wind */}
                <div className="bg-mv-bg-tertiary/50 rounded-lg p-4">
                  <div className="text-xs text-mv-text-muted mb-2">
                    Wind Gusts (mph)
                  </div>
                  <EnhancedWindSparkline
                    gusts={hourlyData.windGusts}
                    height={80}
                  />
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </main>

      <Footer />

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
    </div>
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold text-mv-text-primary">
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
        <div className="bg-mv-bg-tertiary/50 rounded-lg p-4">
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

function CityDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="bg-mv-bg-secondary rounded-xl p-6 border border-white/5">
        <div className="h-40 bg-mv-bg-tertiary rounded" />
      </div>
      <div className="bg-mv-bg-secondary rounded-xl p-6 border border-white/5">
        <div className="h-32 bg-mv-bg-tertiary rounded" />
      </div>
      <div className="bg-mv-bg-secondary rounded-xl p-6 border border-white/5 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-mv-bg-tertiary rounded" />
        ))}
      </div>
    </div>
  );
}
