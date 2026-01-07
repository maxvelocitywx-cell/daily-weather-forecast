'use client';

import { useState } from 'react';
import { RegionId, RegionRiskData, CityMetricsSummary } from '@/lib/types';
import { REGIONS, REGION_ORDER } from '@/lib/regions';
import { RegionCard, RegionCardSkeleton } from './RegionCard';
import { RegionDaySelector } from './RegionDaySelector';

interface RegionListProps {
  regionRisks: Partial<Record<RegionId, RegionRiskData>>;
  cities: CityMetricsSummary[];
  selectedDay: number;
  onDayChange: (day: number) => void;
  onCitySelect: (cityId: string) => void;
  onRegionSelect?: (regionId: RegionId | null) => void;
  isLoading?: boolean;
}

export function RegionList({
  regionRisks,
  cities,
  selectedDay,
  onDayChange,
  onCitySelect,
  onRegionSelect,
  isLoading,
}: RegionListProps) {
  const [expandedRegion, setExpandedRegion] = useState<RegionId | null>(null);

  // Group cities by region
  const citiesByRegion = cities.reduce((acc, city) => {
    if (!acc[city.regionId]) {
      acc[city.regionId] = [];
    }
    acc[city.regionId].push(city);
    return acc;
  }, {} as Record<RegionId, CityMetricsSummary[]>);

  // Sort regions by risk (highest first)
  const sortedRegions = [...REGION_ORDER].sort((a, b) => {
    const riskA = regionRisks[a]?.[`day${selectedDay}` as keyof RegionRiskData];
    const riskB = regionRisks[b]?.[`day${selectedDay}` as keyof RegionRiskData];
    const scoreA = typeof riskA === 'object' && riskA && 'risk' in riskA
      ? (riskA as { risk: number }).risk
      : 0;
    const scoreB = typeof riskB === 'object' && riskB && 'risk' in riskB
      ? (riskB as { risk: number }).risk
      : 0;
    return scoreB - scoreA;
  });

  const handleToggle = (regionId: RegionId) => {
    const newExpanded = expandedRegion === regionId ? null : regionId;
    setExpandedRegion(newExpanded);
    onRegionSelect?.(newExpanded);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-mv-text-primary">
            Regional Outlook
          </h2>
          <RegionDaySelector
            selectedDay={selectedDay}
            onDayChange={onDayChange}
          />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <RegionCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-mv-text-primary">
          Regional Outlook
        </h2>
        <RegionDaySelector
          selectedDay={selectedDay}
          onDayChange={onDayChange}
        />
      </div>

      <div className="space-y-3">
        {sortedRegions.map((regionId) => {
          const riskData = regionRisks[regionId];
          if (!riskData) return null;

          return (
            <RegionCard
              key={regionId}
              regionId={regionId}
              riskData={riskData}
              cities={citiesByRegion[regionId] || []}
              selectedDay={selectedDay}
              isExpanded={expandedRegion === regionId}
              onToggle={() => handleToggle(regionId)}
              onCitySelect={onCitySelect}
            />
          );
        })}
      </div>
    </div>
  );
}

export function RegionListCompact({
  regionRisks,
  selectedDay,
  onRegionSelect,
}: {
  regionRisks: Partial<Record<RegionId, RegionRiskData>>;
  selectedDay: number;
  onRegionSelect: (regionId: RegionId) => void;
}) {
  // Sort by risk
  const sortedRegions = [...REGION_ORDER].sort((a, b) => {
    const riskA = regionRisks[a]?.[`day${selectedDay}` as keyof RegionRiskData];
    const riskB = regionRisks[b]?.[`day${selectedDay}` as keyof RegionRiskData];
    const scoreA = typeof riskA === 'object' && riskA && 'risk' in riskA
      ? (riskA as { risk: number }).risk
      : 0;
    const scoreB = typeof riskB === 'object' && riskB && 'risk' in riskB
      ? (riskB as { risk: number }).risk
      : 0;
    return scoreB - scoreA;
  });

  return (
    <div className="flex flex-wrap gap-2">
      {sortedRegions.map((regionId) => {
        const riskData = regionRisks[regionId];
        const dayData = riskData?.[`day${selectedDay}` as keyof RegionRiskData];
        const risk = typeof dayData === 'object' && dayData && 'risk' in dayData
          ? (dayData as { risk: number }).risk
          : 3;
        const region = REGIONS[regionId];

        return (
          <button
            key={regionId}
            onClick={() => onRegionSelect(regionId)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-mv-bg-tertiary/50 hover:bg-mv-bg-tertiary transition-colors border border-white/5 hover:border-white/10"
          >
            <span className="text-sm text-mv-text-primary">{region.name}</span>
            <span
              className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold"
              style={{
                background: `rgba(${risk <= 3 ? '16, 185, 129' : risk <= 5 ? '234, 179, 8' : risk <= 7 ? '239, 68, 68' : '147, 51, 234'}, 0.2)`,
                color: risk <= 3 ? '#10b981' : risk <= 5 ? '#eab308' : risk <= 7 ? '#ef4444' : '#9333ea',
              }}
            >
              {risk}
            </span>
          </button>
        );
      })}
    </div>
  );
}
