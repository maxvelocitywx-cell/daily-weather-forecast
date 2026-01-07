'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { X, ChevronRight, AlertTriangle, CloudRain, Snowflake, Wind, Thermometer } from 'lucide-react';
import { CityMetricsSummary } from '@/lib/types';
import { RiskBadge } from './RiskBadge';
import { formatCityLabel } from '@/lib/formatCityLabel';

interface CityQuickPanelProps {
  city: CityMetricsSummary | null;
  selectedDay: number;
  onClose: () => void;
  fetchedAt?: string | null;
}

// Category badge colors
const SPC_COLORS: Record<string, string> = {
  'TSTM': 'bg-lime-500/20 text-lime-400 border-lime-500/30',
  'MRGL': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'SLGT': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'ENH': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'MDT': 'bg-red-500/20 text-red-400 border-red-500/30',
  'HIGH': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

const ERO_COLORS: Record<string, string> = {
  'MRGL': 'bg-lime-500/20 text-lime-400 border-lime-500/30',
  'SLGT': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'MDT': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'HIGH': 'bg-red-500/20 text-red-400 border-red-500/30',
};

const WSSI_COLORS: Record<string, string> = {
  'MINOR': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'MODERATE': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'MAJOR': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'EXTREME': 'bg-red-500/20 text-red-400 border-red-500/30',
};

export function CityQuickPanel({ city, selectedDay, onClose, fetchedAt }: CityQuickPanelProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const isOpen = !!city;

  // Get day-specific data from canonical source
  const dayData = useMemo(() => {
    if (!city) return null;
    const dayIndex = selectedDay - 1;
    const dailyRisk = city.dailyRisks?.[dayIndex];
    const dailySummary = city.dailySummary?.[dayIndex];
    const dayInfo = city.days?.[dayIndex];

    // Use canonical risk from days array, fallback to dailyRisks
    const riskScore = dayInfo?.risk ?? dailyRisk?.score_display ?? null;
    const overlay = dailyRisk?.overlay;

    return {
      riskScore,
      spcCategory: overlay?.spc_category && overlay.spc_category !== 'NONE' ? overlay.spc_category : null,
      eroCategory: overlay?.ero_category && overlay.ero_category !== 'NONE' ? overlay.ero_category : null,
      wssiCategory: overlay?.wssi_category && overlay.wssi_category !== 'NONE' ? overlay.wssi_category : null,
      tempHigh: dailySummary?.tmax ?? null,
      tempLow: dailySummary?.tmin ?? null,
      rain: dailySummary?.rain_total ?? null,
      snow: dailySummary?.snow_total ?? null,
      windGust: dailySummary?.wind_gust_max ?? null,
      condition: dayInfo?.condition ?? dailySummary?.conditions?.primary ?? null,
    };
  }, [city, selectedDay]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus panel when opened
  useEffect(() => {
    if (isOpen && panelRef.current) {
      panelRef.current.focus();
    }
  }, [isOpen]);

  // Navigate to full city detail page
  const handleFullForecast = () => {
    if (!city) return;
    const dayKey = `day${selectedDay}`;
    router.push(`/city/${city.cityId || city.id}?day=${dayKey}`);
  };

  // Format updated timestamp
  const formattedUpdate = useMemo(() => {
    if (!fetchedAt) return null;
    try {
      const date = new Date(fetchedAt);
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return null;
    }
  }, [fetchedAt]);

  if (!city || !dayData) return null;

  return (
    <>
      {/* Desktop: Right side panel */}
      <div
        className={clsx(
          'fixed top-0 right-0 h-full z-50 hidden lg:block transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          className="h-full w-80 bg-mv-bg-primary/95 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-lg font-semibold text-mv-text-primary truncate pr-2">
              {formatCityLabel(city)}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
              aria-label="Close panel"
            >
              <X className="w-5 h-5 text-mv-text-muted" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Risk Score */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-mv-text-muted">Day {selectedDay} Risk</span>
              {dayData.riskScore !== null ? (
                <RiskBadge score={dayData.riskScore} size="lg" showLabel />
              ) : (
                <span className="text-mv-text-muted">N/A</span>
              )}
            </div>

            {/* Hazard Categories */}
            {(dayData.spcCategory || dayData.eroCategory || dayData.wssiCategory) && (
              <div className="space-y-2">
                <span className="text-xs text-mv-text-muted uppercase tracking-wide">Active Hazards</span>
                <div className="flex flex-wrap gap-2">
                  {dayData.spcCategory && (
                    <span className={clsx(
                      'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border',
                      SPC_COLORS[dayData.spcCategory] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                    )}>
                      <AlertTriangle className="w-3 h-3" />
                      SPC: {dayData.spcCategory}
                    </span>
                  )}
                  {dayData.eroCategory && (
                    <span className={clsx(
                      'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border',
                      ERO_COLORS[dayData.eroCategory] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                    )}>
                      <CloudRain className="w-3 h-3" />
                      ERO: {dayData.eroCategory}
                    </span>
                  )}
                  {dayData.wssiCategory && (
                    <span className={clsx(
                      'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border',
                      WSSI_COLORS[dayData.wssiCategory] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                    )}>
                      <Snowflake className="w-3 h-3" />
                      WSSI: {dayData.wssiCategory === 'WINTER WEATHER AREA' ? 'WWA' : dayData.wssiCategory}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Weather Metrics */}
            <div className="space-y-2">
              <span className="text-xs text-mv-text-muted uppercase tracking-wide">Weather</span>
              <div className="bg-mv-bg-secondary rounded-lg p-3 space-y-2">
                {/* Temperature */}
                {(dayData.tempHigh !== null || dayData.tempLow !== null) && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-mv-text-secondary">
                      <Thermometer className="w-4 h-4 text-orange-400" />
                      Temperature
                    </div>
                    <span className="text-sm text-mv-text-primary">
                      {dayData.tempHigh !== null ? `${Math.round(dayData.tempHigh)}°` : 'N/A'}
                      {' / '}
                      {dayData.tempLow !== null ? `${Math.round(dayData.tempLow)}°` : 'N/A'}
                    </span>
                  </div>
                )}

                {/* Rain */}
                {dayData.rain !== null && dayData.rain > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-mv-text-secondary">
                      <CloudRain className="w-4 h-4 text-blue-400" />
                      Rain
                    </div>
                    <span className="text-sm text-mv-text-primary">{dayData.rain.toFixed(2)}"</span>
                  </div>
                )}

                {/* Snow */}
                {dayData.snow !== null && dayData.snow > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-mv-text-secondary">
                      <Snowflake className="w-4 h-4 text-sky-400" />
                      Snow
                    </div>
                    <span className="text-sm text-mv-text-primary">{dayData.snow.toFixed(1)}"</span>
                  </div>
                )}

                {/* Wind */}
                {dayData.windGust !== null && dayData.windGust >= 15 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-mv-text-secondary">
                      <Wind className="w-4 h-4 text-yellow-400" />
                      Wind Gust
                    </div>
                    <span className="text-sm text-mv-text-primary">{Math.round(dayData.windGust)} mph</span>
                  </div>
                )}

                {/* No significant weather */}
                {dayData.rain === null && dayData.snow === null && dayData.windGust === null &&
                 dayData.tempHigh === null && dayData.tempLow === null && (
                  <div className="text-sm text-mv-text-muted text-center py-2">
                    No weather data available
                  </div>
                )}
              </div>
            </div>

            {/* Updated timestamp */}
            {formattedUpdate && (
              <div className="text-xs text-mv-text-muted text-center">
                Updated {formattedUpdate}
              </div>
            )}
          </div>

          {/* Footer with action button */}
          <div className="p-4 border-t border-white/10">
            <button
              onClick={handleFullForecast}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-mv-accent-blue hover:bg-mv-accent-blue/90 text-white rounded-lg font-medium transition-colors"
            >
              Full Forecast & Graphs
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile: Bottom sheet */}
      <div
        className={clsx(
          'fixed inset-x-0 bottom-0 z-50 lg:hidden transition-transform duration-300 ease-out',
          isOpen ? 'translate-y-0' : 'translate-y-full'
        )}
      >
        {/* Backdrop */}
        <div
          className={clsx(
            'fixed inset-0 bg-black/50 transition-opacity duration-300',
            isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          onClick={onClose}
        />

        {/* Sheet */}
        <div className="relative bg-mv-bg-primary rounded-t-2xl border-t border-white/10 shadow-2xl max-h-[70vh] flex flex-col">
          {/* Handle */}
          <div className="flex justify-center py-2">
            <div className="w-10 h-1 bg-white/20 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 pb-3 border-b border-white/10">
            <h2 className="text-lg font-semibold text-mv-text-primary truncate pr-2">
              {formatCityLabel(city)}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
              aria-label="Close panel"
            >
              <X className="w-5 h-5 text-mv-text-muted" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* Risk Score */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-mv-text-muted">Day {selectedDay} Risk</span>
              {dayData.riskScore !== null ? (
                <RiskBadge score={dayData.riskScore} size="lg" showLabel />
              ) : (
                <span className="text-mv-text-muted">N/A</span>
              )}
            </div>

            {/* Hazard Categories - Horizontal scroll on mobile */}
            {(dayData.spcCategory || dayData.eroCategory || dayData.wssiCategory) && (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {dayData.spcCategory && (
                  <span className={clsx(
                    'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border whitespace-nowrap',
                    SPC_COLORS[dayData.spcCategory] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                  )}>
                    <AlertTriangle className="w-3 h-3" />
                    SPC: {dayData.spcCategory}
                  </span>
                )}
                {dayData.eroCategory && (
                  <span className={clsx(
                    'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border whitespace-nowrap',
                    ERO_COLORS[dayData.eroCategory] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                  )}>
                    <CloudRain className="w-3 h-3" />
                    ERO: {dayData.eroCategory}
                  </span>
                )}
                {dayData.wssiCategory && (
                  <span className={clsx(
                    'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border whitespace-nowrap',
                    WSSI_COLORS[dayData.wssiCategory] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                  )}>
                    <Snowflake className="w-3 h-3" />
                    WSSI: {dayData.wssiCategory === 'WINTER WEATHER AREA' ? 'WWA' : dayData.wssiCategory}
                  </span>
                )}
              </div>
            )}

            {/* Weather Metrics - Compact grid on mobile */}
            <div className="grid grid-cols-2 gap-2">
              {(dayData.tempHigh !== null || dayData.tempLow !== null) && (
                <div className="bg-mv-bg-secondary rounded-lg p-2 flex items-center gap-2">
                  <Thermometer className="w-4 h-4 text-orange-400" />
                  <span className="text-sm text-mv-text-primary">
                    {dayData.tempHigh !== null ? `${Math.round(dayData.tempHigh)}°` : 'N/A'}
                    {' / '}
                    {dayData.tempLow !== null ? `${Math.round(dayData.tempLow)}°` : 'N/A'}
                  </span>
                </div>
              )}
              {dayData.rain !== null && dayData.rain > 0 && (
                <div className="bg-mv-bg-secondary rounded-lg p-2 flex items-center gap-2">
                  <CloudRain className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-mv-text-primary">{dayData.rain.toFixed(2)}" rain</span>
                </div>
              )}
              {dayData.snow !== null && dayData.snow > 0 && (
                <div className="bg-mv-bg-secondary rounded-lg p-2 flex items-center gap-2">
                  <Snowflake className="w-4 h-4 text-sky-400" />
                  <span className="text-sm text-mv-text-primary">{dayData.snow.toFixed(1)}" snow</span>
                </div>
              )}
              {dayData.windGust !== null && dayData.windGust >= 15 && (
                <div className="bg-mv-bg-secondary rounded-lg p-2 flex items-center gap-2">
                  <Wind className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm text-mv-text-primary">{Math.round(dayData.windGust)} mph</span>
                </div>
              )}
            </div>

            {/* Updated timestamp */}
            {formattedUpdate && (
              <div className="text-xs text-mv-text-muted text-center">
                Updated {formattedUpdate}
              </div>
            )}
          </div>

          {/* Footer with action button */}
          <div className="p-4 border-t border-white/10">
            <button
              onClick={handleFullForecast}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-mv-accent-blue hover:bg-mv-accent-blue/90 text-white rounded-lg font-medium transition-colors"
            >
              Full Forecast & Graphs
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
