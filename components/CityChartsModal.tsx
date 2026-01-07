'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { X, BarChart3, Thermometer, CloudRain, Snowflake, Wind, GitCompare, Download, Link, Check, Plus, Maximize2, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { CityDailySummary, CityDailyRisk, CityMetricsSummary, RegionId } from '@/lib/types';
import { formatDayLabelWithDate } from '@/lib/formatDayLabel';
import { formatCityNameState } from '@/lib/formatCityLabel';
import { exportChartToPNG, generateChartShareUrl, copyChartUrlToClipboard } from '@/lib/chartExport';

interface CityChartsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cityName: string;
  cityState: string;
  regionId: RegionId;
  dailySummary: CityDailySummary[];
  dailyRisks: CityDailyRisk[];
  selectedDay: number;
  onDayChange: (day: number) => void;
  compareCities?: CityMetricsSummary[];
}

// 5 chart types: Risk, Temperature, Rain, Snow, Wind
type ChartTab = 'risk' | 'temp' | 'rain' | 'snow' | 'wind';

// Shared compare city colors
const COMPARE_COLORS = ['#a855f7', '#06b6d4', '#22c55e', '#f43f5e'];

// Primary colors by metric
const PRIMARY_COLORS: Record<ChartTab, string> = {
  risk: '#f59e0b',
  temp: '#f97316',
  rain: '#3b82f6',
  snow: '#8b5cf6',
  wind: '#06b6d4',
};

interface ChartDataPoint {
  day: number;
  dayLabel: string;
  dayDate: string;
  date: string;
  // Primary city data
  risk: number | null;
  tempHigh: number | null;
  tempLow: number | null;
  rain: number | null;
  snow: number | null;
  windGust: number | null;
  // Dynamic compare city data (indexed by cityId)
  [key: string]: string | number | null | undefined;
}

export function CityChartsModal({
  isOpen,
  onClose,
  cityName,
  cityState,
  regionId,
  dailySummary,
  dailyRisks,
  selectedDay,
  onDayChange,
  compareCities = [],
}: CityChartsModalProps) {
  const [activeTab, setActiveTab] = useState<ChartTab>('risk');
  const [compareCityIds, setCompareCityIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isCompareDrawerOpen, setIsCompareDrawerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [compareSearch, setCompareSearch] = useState('');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const fullscreenChartRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else if (isCompareDrawerOpen) {
          setIsCompareDrawerOpen(false);
        } else if (isOpen) {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isFullscreen, isCompareDrawerOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Get compare cities data
  const selectedCompareCities = useMemo(() => {
    return compareCityIds
      .map(id => compareCities.find(c => c.cityId === id))
      .filter((c): c is CityMetricsSummary => !!c);
  }, [compareCityIds, compareCities]);

  // Toggle a comparison city
  const toggleCompareCity = useCallback((cityId: string) => {
    setCompareCityIds(prev => {
      if (prev.includes(cityId)) {
        return prev.filter(id => id !== cityId);
      }
      if (prev.length >= 4) return prev; // Max 4 comparison cities
      return [...prev, cityId];
    });
  }, []);

  // Remove a comparison city
  const removeCompareCity = useCallback((cityId: string) => {
    setCompareCityIds(prev => prev.filter(id => id !== cityId));
  }, []);

  // Clear all comparison cities
  const clearAllCompareCities = useCallback(() => {
    setCompareCityIds([]);
  }, []);

  // Filter compare cities by search
  const filteredCompareCities = useMemo(() => {
    const primaryCityId = cityName.toLowerCase().replace(/\s+/g, '-');
    return compareCities
      .filter(c => c.cityId !== primaryCityId)
      .filter(c => {
        if (!compareSearch.trim()) return true;
        const search = compareSearch.toLowerCase();
        return (
          c.name.toLowerCase().includes(search) ||
          c.state.toLowerCase().includes(search)
        );
      });
  }, [compareCities, cityName, compareSearch]);

  // Transform data for charts - includes all compare cities for all metrics
  const chartData: ChartDataPoint[] = useMemo(() => {
    return dailySummary.map((summary, i) => {
      const risk = dailyRisks[i];
      const dayInfo = formatDayLabelWithDate(i + 1);

      const point: ChartDataPoint = {
        day: i + 1,
        dayLabel: dayInfo.label,
        dayDate: dayInfo.date,
        date: summary.date_local,
        // Primary city data - preserve null for missing data
        risk: risk?.score_display ?? null,
        tempHigh: summary.tmax != null ? Math.round(summary.tmax) : null,
        tempLow: summary.tmin != null ? Math.round(summary.tmin) : null,
        rain: summary.rain_total ?? null,
        snow: summary.snow_total ?? null,
        windGust: summary.wind_gust_max != null ? Math.round(summary.wind_gust_max) : null,
      };

      // Add comparison cities data for ALL metrics
      selectedCompareCities.forEach((city, idx) => {
        const cityRisk = city.dailyRisks?.[i];
        const citySummary = city.dailySummary?.[i];

        // Risk data
        point[`compare_${idx}_risk`] = cityRisk?.score_display ?? null;
        point[`compare_${idx}_name`] = city.name;

        // Temperature data
        point[`compare_${idx}_tempHigh`] = citySummary?.tmax != null ? Math.round(citySummary.tmax) : null;
        point[`compare_${idx}_tempLow`] = citySummary?.tmin != null ? Math.round(citySummary.tmin) : null;

        // Rain data (separate from snow)
        point[`compare_${idx}_rain`] = citySummary?.rain_total ?? null;

        // Snow data (separate from rain)
        point[`compare_${idx}_snow`] = citySummary?.snow_total ?? null;

        // Wind data
        point[`compare_${idx}_windGust`] = citySummary?.wind_gust_max != null ? Math.round(citySummary.wind_gust_max) : null;
      });

      return point;
    });
  }, [dailySummary, dailyRisks, selectedCompareCities]);

  // Handle chart click to select day
  const handleChartClick = useCallback((data: { activePayload?: Array<{ payload: ChartDataPoint }> }) => {
    if (data?.activePayload?.[0]?.payload) {
      onDayChange(data.activePayload[0].payload.day);
    }
  }, [onDayChange]);

  // Export chart to PNG
  const handleExport = useCallback(async () => {
    if (isExporting) return;
    const targetRef = isFullscreen ? fullscreenChartRef.current : chartContainerRef.current;
    if (!targetRef) return;
    setIsExporting(true);
    try {
      const filename = `${cityName.toLowerCase().replace(/\s+/g, '-')}-${activeTab}-chart`;
      await exportChartToPNG(targetRef, filename);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, cityName, activeTab, isFullscreen]);

  // Copy share link
  const handleShare = useCallback(async () => {
    const url = generateChartShareUrl(window.location.href.split('?')[0], {
      cityId: cityName.toLowerCase().replace(/\s+/g, '-'),
      regionId: regionId,
      day: selectedDay,
      tab: activeTab,
      compareCityId: compareCityIds[0] || undefined,
    });
    const success = await copyChartUrlToClipboard(url);
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  }, [cityName, regionId, selectedDay, activeTab, compareCityIds]);

  if (!isOpen) return null;

  // 5 tabs: Risk, Temperature, Rain, Snow, Wind
  const tabs: { id: ChartTab; label: string; icon: typeof BarChart3 }[] = [
    { id: 'risk', label: 'Risk', icon: BarChart3 },
    { id: 'temp', label: 'Temp', icon: Thermometer },
    { id: 'rain', label: 'Rain', icon: CloudRain },
    { id: 'snow', label: 'Snow', icon: Snowflake },
    { id: 'wind', label: 'Wind', icon: Wind },
  ];

  // Render chart based on active tab
  const renderChart = (height: string, forFullscreen = false) => (
    <div
      ref={forFullscreen ? fullscreenChartRef : chartContainerRef}
      className={clsx(
        'relative bg-mv-bg-tertiary/50 rounded-xl p-4 sm:p-5 border border-white/5',
        height
      )}
    >
      {/* Logo watermark */}
      <div className="absolute bottom-3 right-3 opacity-10 pointer-events-none select-none z-10">
        <img
          src="/branding/max-velocity-logo.png"
          alt=""
          className="h-8 w-auto"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>

      {activeTab === 'risk' && (
        <RiskChart
          data={chartData}
          selectedDay={selectedDay}
          onChartClick={handleChartClick}
          compareCities={selectedCompareCities}
          showCompare={selectedCompareCities.length > 0}
          primaryCityName={formatCityNameState(cityName, cityState)}
        />
      )}
      {activeTab === 'temp' && (
        <TempChart
          data={chartData}
          selectedDay={selectedDay}
          onChartClick={handleChartClick}
          compareCities={selectedCompareCities}
          showCompare={selectedCompareCities.length > 0}
          primaryCityName={formatCityNameState(cityName, cityState)}
        />
      )}
      {activeTab === 'rain' && (
        <RainChart
          data={chartData}
          selectedDay={selectedDay}
          onChartClick={handleChartClick}
          compareCities={selectedCompareCities}
          showCompare={selectedCompareCities.length > 0}
          primaryCityName={formatCityNameState(cityName, cityState)}
        />
      )}
      {activeTab === 'snow' && (
        <SnowChart
          data={chartData}
          selectedDay={selectedDay}
          onChartClick={handleChartClick}
          compareCities={selectedCompareCities}
          showCompare={selectedCompareCities.length > 0}
          primaryCityName={formatCityNameState(cityName, cityState)}
        />
      )}
      {activeTab === 'wind' && (
        <WindChart
          data={chartData}
          selectedDay={selectedDay}
          onChartClick={handleChartClick}
          compareCities={selectedCompareCities}
          showCompare={selectedCompareCities.length > 0}
          primaryCityName={formatCityNameState(cityName, cityState)}
        />
      )}
    </div>
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] transition-opacity duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 pointer-events-none">
        <div
          className="bg-gradient-to-b from-mv-bg-primary to-mv-bg-secondary border border-white/10 rounded-2xl shadow-2xl w-full max-w-[1100px] max-h-[95vh] overflow-hidden pointer-events-auto flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Compact Header */}
          <div className="flex-shrink-0 border-b border-white/10 px-4 sm:px-5 py-3 sm:py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-bold text-mv-text-primary tracking-tight truncate">
                  {formatCityNameState(cityName, cityState)}
                </h2>
                <p className="text-xs text-mv-text-muted mt-0.5 hidden sm:block">
                  7-Day Weather Analytics
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Compare button */}
                {compareCities.length > 0 && (
                  <button
                    onClick={() => setIsCompareDrawerOpen(true)}
                    className={clsx(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
                      compareCityIds.length > 0
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'bg-white/5 text-mv-text-muted hover:bg-white/10 hover:text-mv-text-primary'
                    )}
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Compare</span>
                    {compareCityIds.length > 0 && (
                      <span className="px-1.5 py-0.5 bg-purple-500/30 rounded text-[10px]">
                        {compareCityIds.length}
                      </span>
                    )}
                  </button>
                )}

                {/* Fullscreen */}
                <button
                  onClick={() => setIsFullscreen(true)}
                  className="p-2 rounded-lg hover:bg-white/10 transition-all duration-200 text-mv-text-muted hover:text-mv-text-primary"
                  title="Fullscreen"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>

                {/* Export PNG */}
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  className={clsx(
                    'p-2 rounded-lg transition-all duration-200',
                    isExporting
                      ? 'text-mv-text-muted/50 cursor-wait bg-white/5'
                      : 'hover:bg-white/10 text-mv-text-muted hover:text-mv-text-primary'
                  )}
                  title="Download PNG"
                >
                  <Download className="w-4 h-4" />
                </button>

                {/* Share link */}
                <button
                  onClick={handleShare}
                  className={clsx(
                    'p-2 rounded-lg transition-all duration-200',
                    copySuccess
                      ? 'text-emerald-400 bg-emerald-400/10'
                      : 'hover:bg-white/10 text-mv-text-muted hover:text-mv-text-primary'
                  )}
                  title={copySuccess ? 'Copied!' : 'Copy link'}
                >
                  {copySuccess ? <Check className="w-4 h-4" /> : <Link className="w-4 h-4" />}
                </button>

                {/* Close */}
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/10 transition-all duration-200 text-mv-text-muted hover:text-mv-text-primary ml-1"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Compact selected cities chips row - single line with horizontal scroll */}
            {selectedCompareCities.length > 0 && (
              <div className="flex items-center gap-2 mt-2.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-white/10">
                {/* Primary city chip (locked) */}
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-black/30 border border-white/10 whitespace-nowrap flex-shrink-0"
                  style={{ borderLeftColor: PRIMARY_COLORS[activeTab], borderLeftWidth: 3 }}
                >
                  <span className="text-mv-text-primary">{formatCityNameState(cityName, cityState)}</span>
                </div>

                {/* Compare city chips (removable) */}
                {selectedCompareCities.map((city, idx) => (
                  <div
                    key={city.cityId}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap flex-shrink-0 group"
                    style={{ backgroundColor: `${COMPARE_COLORS[idx]}20`, borderLeft: `3px solid ${COMPARE_COLORS[idx]}` }}
                  >
                    <span className="text-mv-text-muted">{formatCityNameState(city.name, city.state)}</span>
                    <button
                      onClick={() => removeCompareCity(city.cityId)}
                      className="opacity-60 hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tab navigation + Day selector row */}
          <div className="flex-shrink-0 border-b border-white/10 px-4 sm:px-5 bg-white/[0.02]">
            <div className="flex items-center justify-between gap-2 py-1">
              {/* Tabs */}
              <div className="flex gap-0.5 overflow-x-auto">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={clsx(
                      'flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium border-b-2 transition-all duration-200 whitespace-nowrap',
                      activeTab === tab.id
                        ? 'border-mv-accent text-mv-accent'
                        : 'border-transparent text-mv-text-muted hover:text-mv-text-primary hover:border-white/20'
                    )}
                  >
                    <tab.icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Day selector - compact pills */}
              <div className="flex gap-1 overflow-x-auto flex-shrink-0">
                {chartData.map((d) => (
                  <button
                    key={d.day}
                    onClick={() => onDayChange(d.day)}
                    className={clsx(
                      'px-2 py-1 rounded text-[10px] sm:text-xs font-medium transition-all duration-200 whitespace-nowrap',
                      selectedDay === d.day
                        ? 'bg-mv-accent text-white'
                        : 'bg-white/5 text-mv-text-muted hover:bg-white/10'
                    )}
                  >
                    {d.dayLabel}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chart content - TALLER charts */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            {/* Chart with increased height */}
            {renderChart('h-[340px] sm:h-[420px] lg:h-[480px]')}

            {/* Selected day quick stats - more compact */}
            <div className="mt-4 p-3 sm:p-4 bg-mv-bg-tertiary/50 rounded-xl border border-white/5">
              <div className="text-xs text-mv-text-muted mb-2 font-medium">
                {chartData[selectedDay - 1]?.dayLabel} ({chartData[selectedDay - 1]?.dayDate})
              </div>
              <div className="grid grid-cols-5 gap-2">
                <MetricDisplay
                  label="Risk"
                  value={chartData[selectedDay - 1]?.risk != null ? (chartData[selectedDay - 1]?.risk as number).toFixed(1) : 'N/A'}
                  color="amber"
                />
                <MetricDisplay
                  label="Hi/Lo"
                  value={
                    chartData[selectedDay - 1]?.tempHigh != null && chartData[selectedDay - 1]?.tempLow != null
                      ? `${chartData[selectedDay - 1]?.tempHigh}°/${chartData[selectedDay - 1]?.tempLow}°`
                      : 'N/A'
                  }
                  color="orange"
                />
                <MetricDisplay
                  label="Rain"
                  value={chartData[selectedDay - 1]?.rain != null ? formatPrecip(chartData[selectedDay - 1]?.rain as number) : 'N/A'}
                  color="blue"
                />
                <MetricDisplay
                  label="Snow"
                  value={chartData[selectedDay - 1]?.snow != null ? formatPrecip(chartData[selectedDay - 1]?.snow as number) : 'N/A'}
                  color="purple"
                />
                <MetricDisplay
                  label="Wind"
                  value={chartData[selectedDay - 1]?.windGust != null ? `${chartData[selectedDay - 1]?.windGust}` : 'N/A'}
                  color="cyan"
                  unit="mph"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Compare Drawer - Side panel on desktop, bottom sheet on mobile */}
      {isCompareDrawerOpen && (
        <>
          {/* Drawer backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-[80]"
            onClick={() => setIsCompareDrawerOpen(false)}
          />

          {/* Drawer panel */}
          <div className={clsx(
            'fixed z-[85] bg-mv-bg-primary border-white/10 shadow-2xl flex flex-col',
            // Mobile: bottom sheet
            'inset-x-0 bottom-0 h-[70vh] rounded-t-2xl border-t',
            // Desktop: right side panel
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[360px] sm:h-full sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0'
          )}>
            {/* Drawer header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div>
                <h3 className="text-base font-semibold text-mv-text-primary">Compare Cities</h3>
                <p className="text-xs text-mv-text-muted mt-0.5">Select up to 4 cities (all charts)</p>
              </div>
              <button
                onClick={() => setIsCompareDrawerOpen(false)}
                className="p-2 rounded-lg hover:bg-white/10 text-mv-text-muted hover:text-mv-text-primary"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-white/5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-text-muted" />
                <input
                  type="text"
                  value={compareSearch}
                  onChange={(e) => setCompareSearch(e.target.value)}
                  placeholder="Search cities..."
                  className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-mv-text-primary placeholder-mv-text-muted focus:outline-none focus:border-white/20"
                />
              </div>
            </div>

            {/* Selected cities */}
            {selectedCompareCities.length > 0 && (
              <div className="p-4 border-b border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-mv-text-muted font-medium">Selected ({selectedCompareCities.length}/4)</span>
                  <button
                    onClick={clearAllCompareCities}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedCompareCities.map((city, idx) => (
                    <div
                      key={city.cityId}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
                      style={{ backgroundColor: `${COMPARE_COLORS[idx]}25` }}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: COMPARE_COLORS[idx] }}
                      />
                      <span className="text-mv-text-primary">{formatCityNameState(city.name, city.state)}</span>
                      <button
                        onClick={() => removeCompareCity(city.cityId)}
                        className="text-mv-text-muted hover:text-mv-text-primary"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* City list */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-1">
                {filteredCompareCities.map(city => {
                  const isSelected = compareCityIds.includes(city.cityId);
                  const colorIndex = compareCityIds.indexOf(city.cityId);
                  const canAdd = !isSelected && compareCityIds.length < 4;

                  return (
                    <button
                      key={city.cityId}
                      onClick={() => toggleCompareCity(city.cityId)}
                      disabled={!isSelected && !canAdd}
                      className={clsx(
                        'flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm transition-all duration-200',
                        isSelected
                          ? 'bg-white/10 text-mv-text-primary'
                          : canAdd
                            ? 'hover:bg-white/5 text-mv-text-muted hover:text-mv-text-primary'
                            : 'opacity-40 cursor-not-allowed text-mv-text-muted'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: COMPARE_COLORS[colorIndex] }}
                          />
                        )}
                        <span>{formatCityNameState(city.name, city.state)}</span>
                      </div>
                      {!isSelected && canAdd && (
                        <Plus className="w-4 h-4 text-mv-text-muted" />
                      )}
                      {isSelected && (
                        <X className="w-4 h-4 text-mv-text-muted" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Drawer footer */}
            <div className="p-4 border-t border-white/10">
              <button
                onClick={() => setIsCompareDrawerOpen(false)}
                className="w-full py-2.5 bg-mv-accent text-white rounded-lg font-medium text-sm hover:bg-mv-accent/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <>
          <div
            className="fixed inset-0 bg-black/90 z-[90]"
            onClick={() => setIsFullscreen(false)}
          />
          <div className="fixed inset-4 sm:inset-8 z-[95] flex flex-col bg-mv-bg-primary rounded-2xl border border-white/10 overflow-hidden">
            {/* Fullscreen header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h3 className="text-lg font-bold text-mv-text-primary">
                  {formatCityNameState(cityName, cityState)} — {tabs.find(t => t.id === activeTab)?.label} Chart
                </h3>
                <p className="text-xs text-mv-text-muted mt-0.5">
                  {chartData[selectedDay - 1]?.dayLabel} ({chartData[selectedDay - 1]?.dayDate})
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Tab switcher in fullscreen */}
                <div className="flex gap-1 bg-white/5 rounded-lg p-1 mr-4">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={clsx(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                        activeTab === tab.id
                          ? 'bg-mv-accent text-white'
                          : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
                      )}
                    >
                      <tab.icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Compare button */}
                {compareCities.length > 0 && (
                  <button
                    onClick={() => setIsCompareDrawerOpen(true)}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
                      compareCityIds.length > 0
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-white/5 text-mv-text-muted hover:bg-white/10'
                    )}
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    Compare
                    {compareCityIds.length > 0 && (
                      <span className="px-1.5 py-0.5 bg-purple-500/30 rounded text-[10px]">
                        {compareCityIds.length}
                      </span>
                    )}
                  </button>
                )}

                {/* Export */}
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  className="p-2 rounded-lg hover:bg-white/10 text-mv-text-muted hover:text-mv-text-primary"
                  title="Download PNG"
                >
                  <Download className="w-4 h-4" />
                </button>

                {/* Close fullscreen */}
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="p-2 rounded-lg hover:bg-white/10 text-mv-text-muted hover:text-mv-text-primary"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Day selector row */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-white/[0.01]">
              <span className="text-xs text-mv-text-muted mr-2">Day:</span>
              {chartData.map((d) => (
                <button
                  key={d.day}
                  onClick={() => onDayChange(d.day)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    selectedDay === d.day
                      ? 'bg-mv-accent text-white'
                      : 'bg-white/5 text-mv-text-muted hover:bg-white/10'
                  )}
                >
                  {d.dayLabel}
                  <span className="ml-1.5 text-[10px] opacity-60">{d.dayDate}</span>
                </button>
              ))}
            </div>

            {/* Selected cities chips */}
            {selectedCompareCities.length > 0 && (
              <div className="flex items-center gap-2 px-5 py-2 border-b border-white/5 overflow-x-auto">
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-black/30 border border-white/10 whitespace-nowrap flex-shrink-0"
                  style={{ borderLeftColor: PRIMARY_COLORS[activeTab], borderLeftWidth: 3 }}
                >
                  <span className="text-mv-text-primary">{formatCityNameState(cityName, cityState)}</span>
                </div>
                {selectedCompareCities.map((city, idx) => (
                  <div
                    key={city.cityId}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap flex-shrink-0"
                    style={{ backgroundColor: `${COMPARE_COLORS[idx]}20`, borderLeft: `3px solid ${COMPARE_COLORS[idx]}` }}
                  >
                    <span className="text-mv-text-muted">{formatCityNameState(city.name, city.state)}</span>
                    <button onClick={() => removeCompareCity(city.cityId)} className="opacity-60 hover:opacity-100">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Fullscreen chart - maximum height */}
            <div className="flex-1 p-5 overflow-hidden">
              {renderChart('h-full', true)}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// Custom XAxis tick with day name and date
function CustomXAxisTick({ x, y, payload, data }: { x: number; y: number; payload: { value: string; index: number }; data: ChartDataPoint[] }) {
  const point = data[payload.index];
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={14} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize={11} fontWeight={600}>
        {point?.dayLabel}
      </text>
      <text x={0} y={0} dy={28} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={10}>
        {point?.dayDate}
      </text>
    </g>
  );
}

// Enhanced Custom Tooltip with better detail
function EnhancedTooltip({
  active,
  payload,
  label,
  primaryCityName,
  compareCities,
  metricLabel,
  formatFn,
  unit = '',
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | null; color: string; dataKey: string }>;
  label?: string;
  primaryCityName: string;
  compareCities: CityMetricsSummary[];
  metricLabel: string;
  formatFn: (value: number) => string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;

  // Group by city
  const groupedData: { city: string; color: string; value: number | null }[] = [];

  // Find primary city data
  const primaryValues = payload.filter(p => !p.dataKey.startsWith('compare_'));
  if (primaryValues.length > 0) {
    groupedData.push({
      city: primaryCityName,
      color: primaryValues[0].color,
      value: primaryValues[0].value,
    });
  }

  // Find compare city data
  compareCities.forEach((city, idx) => {
    const compareValues = payload.filter(p => p.dataKey.startsWith(`compare_${idx}_`));
    if (compareValues.length > 0) {
      groupedData.push({
        city: formatCityNameState(city.name, city.state),
        color: COMPARE_COLORS[idx],
        value: compareValues[0].value,
      });
    }
  });

  return (
    <div className="bg-mv-bg-primary/98 backdrop-blur-md border border-white/15 rounded-xl p-3 shadow-2xl min-w-[160px]">
      <p className="text-mv-text-primary font-semibold text-sm mb-2 pb-1.5 border-b border-white/10">{label}</p>
      <div className="text-[10px] text-mv-text-muted mb-1.5 uppercase tracking-wide">{metricLabel}</div>
      <div className="space-y-1.5">
        {groupedData.map((group, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
              <span className="text-xs text-mv-text-muted truncate">{group.city}</span>
            </div>
            <span className="text-sm text-mv-text-primary font-semibold whitespace-nowrap">
              {group.value != null ? `${formatFn(group.value)}${unit}` : 'N/A'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Temperature-specific tooltip showing both High and Low for each city
function TemperatureTooltip({
  active,
  payload,
  label,
  primaryCityName,
  compareCities,
  data,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | null; color: string; dataKey: string; payload: ChartDataPoint }>;
  label?: string;
  primaryCityName: string;
  compareCities: CityMetricsSummary[];
  data: ChartDataPoint[];
}) {
  if (!active || !payload?.length) return null;

  // Get the data point for the current hover position
  const dataPoint = payload[0]?.payload;
  if (!dataPoint) return null;

  // Build city temperature data
  interface CityTempData {
    city: string;
    highColor: string;
    lowColor: string;
    high: number | null;
    low: number | null;
  }

  const cityTemps: CityTempData[] = [];

  // Primary city
  cityTemps.push({
    city: primaryCityName,
    highColor: '#f97316', // Orange for high
    lowColor: '#3b82f6',  // Blue for low
    high: dataPoint.tempHigh,
    low: dataPoint.tempLow,
  });

  // Compare cities
  compareCities.forEach((city, idx) => {
    const high = dataPoint[`compare_${idx}_tempHigh`] as number | null;
    const low = dataPoint[`compare_${idx}_tempLow`] as number | null;

    cityTemps.push({
      city: formatCityNameState(city.name, city.state),
      highColor: COMPARE_COLORS[idx],
      lowColor: COMPARE_COLORS[idx],
      high,
      low,
    });
  });

  // Get date info
  const dayLabel = dataPoint.dayLabel;
  const dayDate = dataPoint.dayDate;

  return (
    <div className="bg-mv-bg-primary/98 backdrop-blur-md border border-white/15 rounded-xl p-3 shadow-2xl min-w-[200px]">
      {/* Header with day label and date */}
      <div className="mb-2 pb-1.5 border-b border-white/10">
        <p className="text-mv-text-primary font-semibold text-sm">{dayLabel}</p>
        <p className="text-[10px] text-mv-text-muted">{dayDate}</p>
      </div>

      <div className="text-[10px] text-mv-text-muted mb-2 uppercase tracking-wide">Temperature °F</div>

      <div className="space-y-2.5">
        {cityTemps.map((cityData, i) => (
          <div key={i} className="space-y-1">
            {/* City name */}
            <div className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: cityData.highColor }}
              />
              <span className="text-xs text-mv-text-primary font-medium truncate">{cityData.city}</span>
            </div>

            {/* High and Low values */}
            <div className="flex items-center gap-3 pl-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-mv-text-muted">High:</span>
                <span className="text-sm font-semibold" style={{ color: cityData.highColor }}>
                  {cityData.high != null ? `${Math.round(cityData.high)}°F` : 'N/A'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-mv-text-muted">Low:</span>
                <span className="text-sm font-semibold" style={{ color: i === 0 ? cityData.lowColor : `${cityData.lowColor}99` }}>
                  {cityData.low != null ? `${Math.round(cityData.low)}°F` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Shared chart props interface
interface SharedChartProps {
  data: ChartDataPoint[];
  selectedDay: number;
  onChartClick: (data: any) => void;
  compareCities: CityMetricsSummary[];
  showCompare: boolean;
  primaryCityName: string;
}

// Risk Score Chart
function RiskChart({ data, selectedDay, onChartClick, compareCities, showCompare, primaryCityName }: SharedChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} onClick={onChartClick} margin={{ top: 20, right: 30, left: 10, bottom: 35 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="dayLabel"
          stroke="rgba(255,255,255,0.3)"
          tick={(props) => <CustomXAxisTick {...props} data={data} />}
          height={45}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
        />
        <YAxis
          domain={[0, 10]}
          stroke="rgba(255,255,255,0.3)"
          tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          tickFormatter={(v) => v.toFixed(0)}
          tickLine={false}
          axisLine={false}
          width={35}
          ticks={[0, 2, 4, 6, 8, 10]}
        />
        <Tooltip
          content={(props: any) => (
            <EnhancedTooltip
              {...props}
              primaryCityName={primaryCityName}
              compareCities={compareCities}
              metricLabel="Risk Score"
              formatFn={(v) => v.toFixed(1)}
            />
          )}
        />
        <ReferenceLine x={data[selectedDay - 1]?.dayLabel} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" />

        {/* Primary city line */}
        <Line
          type="monotone"
          dataKey="risk"
          name="Risk Score"
          stroke="#f59e0b"
          strokeWidth={3}
          dot={{ fill: '#f59e0b', strokeWidth: 0, r: 5 }}
          activeDot={{ r: 8, fill: '#fbbf24', stroke: '#f59e0b', strokeWidth: 2 }}
          connectNulls
        />

        {/* Comparison city lines */}
        {showCompare && compareCities.map((_, idx) => (
          <Line
            key={idx}
            type="monotone"
            dataKey={`compare_${idx}_risk`}
            name={`Compare ${idx + 1}`}
            stroke={COMPARE_COLORS[idx]}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={{ fill: COMPARE_COLORS[idx], strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6, fill: COMPARE_COLORS[idx] }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Temperature Chart
function TempChart({ data, selectedDay, onChartClick, compareCities, showCompare, primaryCityName }: SharedChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} onClick={onChartClick} margin={{ top: 20, right: 30, left: 10, bottom: 35 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="dayLabel"
          stroke="rgba(255,255,255,0.3)"
          tick={(props) => <CustomXAxisTick {...props} data={data} />}
          height={45}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
        />
        <YAxis
          stroke="rgba(255,255,255,0.3)"
          tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          tickFormatter={(v) => `${v}°`}
          tickLine={false}
          axisLine={false}
          width={45}
        />
        <Tooltip
          content={(props: any) => (
            <TemperatureTooltip
              {...props}
              primaryCityName={primaryCityName}
              compareCities={compareCities}
              data={data}
            />
          )}
        />
        <ReferenceLine x={data[selectedDay - 1]?.dayLabel} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" />

        {/* Primary city lines */}
        <Line
          type="monotone"
          dataKey="tempHigh"
          name="High °F"
          stroke="#f97316"
          strokeWidth={3}
          dot={{ fill: '#f97316', strokeWidth: 0, r: 5 }}
          activeDot={{ r: 8, fill: '#fb923c', stroke: '#f97316', strokeWidth: 2 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="tempLow"
          name="Low °F"
          stroke="#3b82f6"
          strokeWidth={3}
          dot={{ fill: '#3b82f6', strokeWidth: 0, r: 5 }}
          activeDot={{ r: 8, fill: '#60a5fa', stroke: '#3b82f6', strokeWidth: 2 }}
          connectNulls
        />

        {/* Comparison city lines */}
        {showCompare && compareCities.map((_, idx) => (
          <Line
            key={`high-${idx}`}
            type="monotone"
            dataKey={`compare_${idx}_tempHigh`}
            name={`Compare ${idx + 1} High`}
            stroke={COMPARE_COLORS[idx]}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={{ fill: COMPARE_COLORS[idx], strokeWidth: 0, r: 3 }}
            connectNulls
          />
        ))}
        {showCompare && compareCities.map((_, idx) => (
          <Line
            key={`low-${idx}`}
            type="monotone"
            dataKey={`compare_${idx}_tempLow`}
            name={`Compare ${idx + 1} Low`}
            stroke={COMPARE_COLORS[idx]}
            strokeWidth={2}
            strokeDasharray="2 2"
            dot={{ fill: COMPARE_COLORS[idx], strokeWidth: 0, r: 3 }}
            opacity={0.7}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Rain Chart (separate from Snow)
function RainChart({ data, selectedDay, onChartClick, compareCities, showCompare, primaryCityName }: SharedChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} onClick={onChartClick} margin={{ top: 20, right: 30, left: 10, bottom: 35 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="dayLabel"
          stroke="rgba(255,255,255,0.3)"
          tick={(props) => <CustomXAxisTick {...props} data={data} />}
          height={45}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
        />
        <YAxis
          stroke="rgba(255,255,255,0.3)"
          tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          tickFormatter={(v) => formatPrecip(v)}
          tickLine={false}
          axisLine={false}
          width={45}
          label={{ value: 'in', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
        />
        <Tooltip
          content={(props: any) => (
            <EnhancedTooltip
              {...props}
              primaryCityName={primaryCityName}
              compareCities={compareCities}
              metricLabel="Rain"
              formatFn={(v) => formatPrecip(v)}
            />
          )}
        />
        <ReferenceLine x={data[selectedDay - 1]?.dayLabel} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" />

        {/* Primary city bar - rain only */}
        <Bar
          dataKey="rain"
          name="Rain (in)"
          fill="#3b82f6"
          radius={[4, 4, 0, 0]}
        />

        {/* Comparison city bars */}
        {showCompare && compareCities.map((_, idx) => (
          <Bar
            key={idx}
            dataKey={`compare_${idx}_rain`}
            name={`Compare ${idx + 1} Rain`}
            fill={COMPARE_COLORS[idx]}
            opacity={0.6}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Snow Chart (separate from Rain)
function SnowChart({ data, selectedDay, onChartClick, compareCities, showCompare, primaryCityName }: SharedChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} onClick={onChartClick} margin={{ top: 20, right: 30, left: 10, bottom: 35 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="dayLabel"
          stroke="rgba(255,255,255,0.3)"
          tick={(props) => <CustomXAxisTick {...props} data={data} />}
          height={45}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
        />
        <YAxis
          stroke="rgba(255,255,255,0.3)"
          tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          tickFormatter={(v) => formatPrecip(v)}
          tickLine={false}
          axisLine={false}
          width={45}
          label={{ value: 'in', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
        />
        <Tooltip
          content={(props: any) => (
            <EnhancedTooltip
              {...props}
              primaryCityName={primaryCityName}
              compareCities={compareCities}
              metricLabel="Snow"
              formatFn={(v) => formatPrecip(v)}
            />
          )}
        />
        <ReferenceLine x={data[selectedDay - 1]?.dayLabel} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" />

        {/* Primary city bar - snow only */}
        <Bar
          dataKey="snow"
          name="Snow (in)"
          fill="#8b5cf6"
          radius={[4, 4, 0, 0]}
        />

        {/* Comparison city bars */}
        {showCompare && compareCities.map((_, idx) => (
          <Bar
            key={idx}
            dataKey={`compare_${idx}_snow`}
            name={`Compare ${idx + 1} Snow`}
            fill={COMPARE_COLORS[idx]}
            opacity={0.6}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Wind Chart
function WindChart({ data, selectedDay, onChartClick, compareCities, showCompare, primaryCityName }: SharedChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} onClick={onChartClick} margin={{ top: 20, right: 30, left: 10, bottom: 35 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="dayLabel"
          stroke="rgba(255,255,255,0.3)"
          tick={(props) => <CustomXAxisTick {...props} data={data} />}
          height={45}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
        />
        <YAxis
          stroke="rgba(255,255,255,0.3)"
          tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          tickFormatter={(v) => `${v}`}
          tickLine={false}
          axisLine={false}
          width={40}
          label={{ value: 'mph', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
        />
        <Tooltip
          content={(props: any) => (
            <EnhancedTooltip
              {...props}
              primaryCityName={primaryCityName}
              compareCities={compareCities}
              metricLabel="Wind Gust"
              formatFn={(v) => `${Math.round(v)}`}
              unit=" mph"
            />
          )}
        />
        <ReferenceLine x={data[selectedDay - 1]?.dayLabel} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" />

        {/* Primary city bar */}
        <Bar
          dataKey="windGust"
          name="Wind Gust (mph)"
          fill="#06b6d4"
          radius={[4, 4, 0, 0]}
        />

        {/* Comparison city bars */}
        {showCompare && compareCities.map((_, idx) => (
          <Bar
            key={idx}
            dataKey={`compare_${idx}_windGust`}
            name={`Compare ${idx + 1} Wind`}
            fill={COMPARE_COLORS[idx]}
            opacity={0.6}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Metric display for selected day - more compact
function MetricDisplay({
  label,
  value,
  color,
  unit = '',
}: {
  label: string;
  value: string;
  color: 'amber' | 'orange' | 'blue' | 'purple' | 'cyan';
  unit?: string;
}) {
  const colorClasses = {
    amber: 'text-amber-400',
    orange: 'text-orange-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    cyan: 'text-cyan-400',
  };

  return (
    <div className="text-center p-2 bg-black/20 rounded-lg">
      <div className="text-[10px] text-mv-text-muted mb-0.5 font-medium uppercase tracking-wide">{label}</div>
      <div className={clsx('text-sm sm:text-base font-bold', colorClasses[color])}>
        {value}
        {unit && <span className="text-xs font-normal opacity-70 ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

// Format precipitation with 2 decimals, hide trailing zeros
function formatPrecip(value: number): string {
  if (value === 0 || value == null) return '0"';
  const formatted = value.toFixed(2);
  return formatted.replace(/\.?0+$/, '') + '"';
}
