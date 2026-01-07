'use client';

import { useMemo } from 'react';
import { RegionId, RegionRiskData, NationalForecast, RiskExplainPayload, DayExplainPayload } from '@/lib/types';
import { REGIONS, REGION_ORDER } from '@/lib/regions';
import { RiskBadge } from './RiskBadge';
import { National7DayBarGraph } from './National7DayBarGraph';
import { useForecastText } from '@/hooks/useForecastText';
import { WhyThisScore } from './WhyThisScore';

interface NationalSummaryProps {
  regionRisks: Partial<Record<RegionId, RegionRiskData>>;
  national?: NationalForecast & { explain?: RiskExplainPayload; daily?: any[] };
  selectedDay: number;
  onDayChange: (day: number) => void;
}

export function NationalSummary({
  regionRisks,
  national,
  selectedDay,
  onDayChange,
}: NationalSummaryProps) {
  const { narrative, isLoading: narrativeLoading } = useForecastText('national');

  // Calculate national average risk for each day
  const nationalRiskByDay = useMemo(() => {
    const days = [1, 2, 3, 4, 5, 6, 7];
    return days.map((day) => {
      const risks: number[] = [];
      Object.values(regionRisks).forEach((region) => {
        const dayKey = `day${day}` as keyof RegionRiskData;
        const dayData = region[dayKey];
        if (typeof dayData === 'object' && dayData && 'risk' in dayData) {
          risks.push((dayData as { risk: number }).risk);
        }
      });
      const avgRisk = risks.length > 0
        ? risks.reduce((a, b) => a + b, 0) / risks.length
        : 3;
      return {
        day,
        risk: Math.round(avgRisk * 10) / 10,
      };
    });
  }, [regionRisks]);

  // Get today's national risk and explain data
  const todayRisk = nationalRiskByDay[0]?.risk || 3;

  // Get the current day's explain from national.daily (0-indexed)
  const currentDayExplain = useMemo((): DayExplainPayload | undefined => {
    if (!national?.daily || national.daily.length === 0) return undefined;
    const dayData = national.daily[selectedDay - 1];
    return dayData?.explain;
  }, [national, selectedDay]);

  // Find highest risk region for selected day
  const highestRiskRegion = useMemo((): { id: RegionId; risk: number } | null => {
    const entries = Object.entries(regionRisks);
    if (entries.length === 0) return null;

    return entries.reduce<{ id: RegionId; risk: number } | null>((highest, [id, data]) => {
      if (!data) return highest;
      const dayKey = `day${selectedDay}` as keyof RegionRiskData;
      const dayData = data[dayKey];
      const risk = typeof dayData === 'object' && dayData && 'risk' in dayData
        ? (dayData as { risk: number }).risk
        : 0;

      if (!highest || risk > highest.risk) {
        return { id: id as RegionId, risk };
      }
      return highest;
    }, null);
  }, [regionRisks, selectedDay]);

  return (
    <div className="bg-mv-bg-secondary rounded-xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-mv-text-primary">
              National Overview
            </h2>
            <p className="text-sm text-mv-text-muted mt-1">
              Continental United States weather outlook
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RiskBadge score={todayRisk} size="lg" showLabel />
            <WhyThisScore explain={currentDayExplain} score={todayRisk} position="left" />
          </div>
        </div>

        {/* Narrative */}
        <div className="mt-4">
          {narrativeLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-4 bg-mv-bg-tertiary rounded w-full" />
              <div className="h-4 bg-mv-bg-tertiary rounded w-5/6" />
              <div className="h-4 bg-mv-bg-tertiary rounded w-4/6" />
            </div>
          ) : narrative ? (
            <p className="text-sm text-mv-text-secondary leading-relaxed">
              {narrative}
            </p>
          ) : (
            <p className="text-sm text-mv-text-muted italic">
              Weather synopsis loading...
            </p>
          )}
        </div>
      </div>

      {/* 7-Day Bar Graph */}
      <div className="p-6 border-b border-white/5">
        <h3 className="text-sm font-medium text-mv-text-muted mb-4">
          7-Day National Risk Trend
        </h3>
        <National7DayBarGraph
          data={nationalRiskByDay}
          selectedDay={selectedDay}
          onDayClick={onDayChange}
        />
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 divide-x divide-white/5">
        <StatCard
          label="Highest Risk"
          value={highestRiskRegion ? REGIONS[highestRiskRegion.id as RegionId]?.name || '--' : '--'}
          subValue={highestRiskRegion ? `Risk ${highestRiskRegion.risk}/10` : ''}
          color="red"
        />
        <StatCard
          label="Regions Monitored"
          value="7"
          subValue="Active tracking"
          color="blue"
        />
        <StatCard
          label="Cities Tracked"
          value="60+"
          subValue="Real-time data"
          color="green"
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subValue,
  color,
}: {
  label: string;
  value: string;
  subValue: string;
  color: 'red' | 'blue' | 'green';
}) {
  const colorClasses = {
    red: 'text-red-400',
    blue: 'text-blue-400',
    green: 'text-emerald-400',
  };

  return (
    <div className="p-4 text-center">
      <div className="text-xs text-mv-text-muted mb-1">{label}</div>
      <div className={`text-lg font-semibold ${colorClasses[color]}`}>
        {value}
      </div>
      <div className="text-xs text-mv-text-muted">{subValue}</div>
    </div>
  );
}

export function NationalSummarySkeleton() {
  return (
    <div className="bg-mv-bg-secondary rounded-xl border border-white/5 overflow-hidden animate-pulse">
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="h-7 w-48 bg-mv-bg-tertiary rounded" />
            <div className="h-4 w-64 bg-mv-bg-tertiary rounded mt-2" />
          </div>
          <div className="w-16 h-16 bg-mv-bg-tertiary rounded-lg" />
        </div>
        <div className="space-y-2 mt-4">
          <div className="h-4 bg-mv-bg-tertiary rounded w-full" />
          <div className="h-4 bg-mv-bg-tertiary rounded w-5/6" />
        </div>
      </div>
      <div className="p-6 border-b border-white/5">
        <div className="h-40 bg-mv-bg-tertiary rounded" />
      </div>
      <div className="grid grid-cols-3 divide-x divide-white/5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-4">
            <div className="h-4 w-20 bg-mv-bg-tertiary rounded mx-auto mb-2" />
            <div className="h-6 w-12 bg-mv-bg-tertiary rounded mx-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
