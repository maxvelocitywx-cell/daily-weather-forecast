'use client';

import { useMemo, useState, useCallback } from 'react';
import clsx from 'clsx';
import { ChartCrosshair } from './InteractiveChartShell';

interface SparklineProps {
  width?: number;
  height?: number;
  showThresholds?: boolean;
  showIcons?: boolean;
  showMinMax?: boolean;
  interactive?: boolean;
}

interface TempSparklineProps extends SparklineProps {
  temps: number[];
  timestamps?: string[];
}

interface PrecipSparklineProps extends SparklineProps {
  precip: number[];
  timestamps?: string[];
}

interface WindSparklineProps extends SparklineProps {
  gusts: number[];
  timestamps?: string[];
}

interface TooltipData {
  x: number;
  y: number;
  value: number;
  index: number;
  label: string;
}

// SVG path helpers
function createPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');
}

function createAreaPath(points: { x: number; y: number }[], height: number): string {
  if (points.length === 0) return '';
  const linePath = createPath(points);
  return `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;
}

function formatHourLabel(index: number): string {
  const hour = index % 24;
  const day = Math.floor(index / 24) + 1;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `Day ${day}, ${hour12}${ampm}`;
}

export function EnhancedTempSparkline({
  temps,
  timestamps,
  width = 400,
  height = 80,
  showThresholds = true,
  showMinMax = true,
  interactive = true,
}: TempSparklineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const { points, min, max, freezingY } = useMemo(() => {
    if (temps.length === 0) return { points: [], min: 0, max: 100, freezingY: null };

    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const range = maxTemp - minTemp || 1;
    const padding = 10;

    const pts = temps.map((temp, i) => ({
      x: temps.length > 1 ? (i / (temps.length - 1)) * width : width / 2,
      y: padding + ((maxTemp - temp) / range) * (height - 2 * padding),
      value: temp,
    }));

    let fY = null;
    if (minTemp < 32 && maxTemp > 32) {
      fY = padding + ((maxTemp - 32) / range) * (height - 2 * padding);
    }

    return { points: pts, min: minTemp, max: maxTemp, freezingY: fY };
  }, [temps, width, height]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive || points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const index = Math.round((x / width) * (temps.length - 1));
    const clampedIndex = Math.max(0, Math.min(index, temps.length - 1));

    if (clampedIndex !== hoveredIndex) {
      setHoveredIndex(clampedIndex);
      const point = points[clampedIndex];
      if (point) {
        setTooltip({
          x: point.x,
          y: point.y,
          value: temps[clampedIndex],
          index: clampedIndex,
          label: timestamps?.[clampedIndex] || formatHourLabel(clampedIndex),
        });
      }
    }
  }, [interactive, points, temps, timestamps, width, hoveredIndex]);

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
    setTooltip(null);
  }, []);

  if (temps.length === 0) {
    return <div className="h-20 bg-mv-bg-tertiary/30 rounded animate-pulse" />;
  }

  return (
    <div className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id="tempGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(239, 68, 68)" stopOpacity="0.3" />
            <stop offset="50%" stopColor="rgb(251, 146, 60)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        <path d={createAreaPath(points, height)} fill="url(#tempGradient)" />

        {showThresholds && freezingY !== null && (
          <line
            x1="0"
            y1={freezingY}
            x2={width}
            y2={freezingY}
            stroke="rgb(96, 165, 250)"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.5"
          />
        )}

        {interactive && (
          <ChartCrosshair
            x={hoveredIndex !== null ? points[hoveredIndex]?.x ?? null : null}
            y={hoveredIndex !== null ? points[hoveredIndex]?.y ?? null : null}
            width={width}
            height={height}
            showVertical={true}
            showHorizontal={true}
          />
        )}

        <path
          d={createPath(points)}
          fill="none"
          stroke="rgb(251, 146, 60)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {interactive && hoveredIndex !== null && points[hoveredIndex] && (
          <circle
            cx={points[hoveredIndex].x}
            cy={points[hoveredIndex].y}
            r="5"
            fill="rgb(251, 146, 60)"
            stroke="white"
            strokeWidth="2"
            className="pointer-events-none"
          />
        )}

        {showMinMax && (
          <>
            <text x={width - 5} y="12" textAnchor="end" className="fill-red-400 text-xs font-medium">
              {Math.round(max)}°
            </text>
            <text x={width - 5} y={height - 4} textAnchor="end" className="fill-blue-400 text-xs font-medium">
              {Math.round(min)}°
            </text>
          </>
        )}
      </svg>

      {interactive && tooltip && (
        <div
          className="absolute pointer-events-none z-50"
          style={{
            left: Math.min(Math.max(tooltip.x - 50, 5), width - 105),
            top: Math.max(tooltip.y - 45, 5),
          }}
        >
          <div className="bg-mv-bg-primary/95 backdrop-blur-sm border border-white/20 rounded-lg px-2.5 py-1.5 shadow-xl">
            <div className="text-[10px] text-mv-text-muted">{tooltip.label}</div>
            <div className="flex items-center gap-1.5">
              <span className="text-orange-400 font-semibold">{Math.round(tooltip.value)}°F</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function EnhancedPrecipSparkline({
  precip,
  timestamps,
  width = 400,
  height = 80,
  showThresholds = true,
  showMinMax = true,
  interactive = true,
}: PrecipSparklineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const { bars, total, max, barWidth } = useMemo(() => {
    if (precip.length === 0) return { bars: [], total: 0, max: 0, barWidth: 0 };

    const maxPrecip = Math.max(...precip, 0.1);
    const totalPrecip = precip.reduce((a, b) => a + b, 0);
    const bw = width / precip.length;
    const padding = 10;

    const bs = precip.map((p, i) => ({
      x: i * bw,
      centerX: i * bw + bw / 2,
      height: (p / maxPrecip) * (height - padding),
      value: p,
    }));

    return { bars: bs, total: totalPrecip, max: maxPrecip, barWidth: bw };
  }, [precip, width, height]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive || bars.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const index = Math.floor(x / barWidth);
    const clampedIndex = Math.max(0, Math.min(index, precip.length - 1));

    if (clampedIndex !== hoveredIndex) {
      setHoveredIndex(clampedIndex);
      const bar = bars[clampedIndex];
      if (bar) {
        setTooltip({
          x: bar.centerX,
          y: height - bar.height - 10,
          value: precip[clampedIndex],
          index: clampedIndex,
          label: timestamps?.[clampedIndex] || formatHourLabel(clampedIndex),
        });
      }
    }
  }, [interactive, bars, precip, timestamps, width, barWidth, height, hoveredIndex]);

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
    setTooltip(null);
  }, []);

  if (precip.length === 0) {
    return <div className="h-20 bg-mv-bg-tertiary/30 rounded animate-pulse" />;
  }

  return (
    <div className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {interactive && (
          <ChartCrosshair
            x={hoveredIndex !== null ? bars[hoveredIndex]?.centerX ?? null : null}
            y={null}
            width={width}
            height={height}
            showVertical={true}
            showHorizontal={false}
          />
        )}

        {bars.map((bar, i) => {
          const isHovered = hoveredIndex === i;
          const isDimmed = hoveredIndex !== null && !isHovered;

          return (
            <rect
              key={i}
              x={bar.x + 1}
              y={height - bar.height}
              width={Math.max(1, barWidth - 2)}
              height={bar.height}
              fill="rgb(96, 165, 250)"
              className="transition-opacity duration-100"
              style={{
                opacity: isDimmed ? 0.3 : bar.value > 0 ? (isHovered ? 0.9 : 0.7) : 0.1,
              }}
              rx="1"
            />
          );
        })}

        {showThresholds && max >= 0.25 && (
          <line
            x1="0"
            y1={height - (0.25 / max) * (height - 10)}
            x2={width}
            y2={height - (0.25 / max) * (height - 10)}
            stroke="rgb(96, 165, 250)"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.3"
          />
        )}

        {showMinMax && total > 0 && (
          <text x={width - 5} y="12" textAnchor="end" className="fill-blue-400 text-xs font-medium">
            {total.toFixed(2)}"
          </text>
        )}
      </svg>

      {interactive && tooltip && (
        <div
          className="absolute pointer-events-none z-50"
          style={{
            left: Math.min(Math.max(tooltip.x - 50, 5), width - 105),
            top: Math.max(tooltip.y - 45, 5),
          }}
        >
          <div className="bg-mv-bg-primary/95 backdrop-blur-sm border border-white/20 rounded-lg px-2.5 py-1.5 shadow-xl">
            <div className="text-[10px] text-mv-text-muted">{tooltip.label}</div>
            <div className="flex items-center gap-1.5">
              <span className="text-blue-400 font-semibold">{tooltip.value.toFixed(2)}"</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function EnhancedWindSparkline({
  gusts,
  timestamps,
  width = 400,
  height = 80,
  showThresholds = true,
  showMinMax = true,
  interactive = true,
}: WindSparklineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const { points, max, threshold40Y, threshold60Y } = useMemo(() => {
    if (gusts.length === 0) return { points: [], max: 0, threshold40Y: null, threshold60Y: null };

    const maxGust = Math.max(...gusts, 20);
    const padding = 10;

    const pts = gusts.map((gust, i) => ({
      x: gusts.length > 1 ? (i / (gusts.length - 1)) * width : width / 2,
      y: padding + ((maxGust - gust) / maxGust) * (height - 2 * padding),
      value: gust,
    }));

    const t40 = maxGust >= 40 ? padding + ((maxGust - 40) / maxGust) * (height - 2 * padding) : null;
    const t60 = maxGust >= 60 ? padding + ((maxGust - 60) / maxGust) * (height - 2 * padding) : null;

    return { points: pts, max: maxGust, threshold40Y: t40, threshold60Y: t60 };
  }, [gusts, width, height]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive || points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const index = Math.round((x / width) * (gusts.length - 1));
    const clampedIndex = Math.max(0, Math.min(index, gusts.length - 1));

    if (clampedIndex !== hoveredIndex) {
      setHoveredIndex(clampedIndex);
      const point = points[clampedIndex];
      if (point) {
        setTooltip({
          x: point.x,
          y: point.y,
          value: gusts[clampedIndex],
          index: clampedIndex,
          label: timestamps?.[clampedIndex] || formatHourLabel(clampedIndex),
        });
      }
    }
  }, [interactive, points, gusts, timestamps, width, hoveredIndex]);

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
    setTooltip(null);
  }, []);

  if (gusts.length === 0) {
    return <div className="h-20 bg-mv-bg-tertiary/30 rounded animate-pulse" />;
  }

  const getWindWarningColor = (speed: number): string => {
    if (speed >= 60) return 'text-red-400';
    if (speed >= 40) return 'text-orange-400';
    return 'text-yellow-400';
  };

  return (
    <div className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id="windGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(251, 191, 36)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(251, 191, 36)" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        <path d={createAreaPath(points, height)} fill="url(#windGradient)" />

        {showThresholds && threshold40Y !== null && (
          <line
            x1="0"
            y1={threshold40Y}
            x2={width}
            y2={threshold40Y}
            stroke="rgb(251, 191, 36)"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.4"
          />
        )}
        {showThresholds && threshold60Y !== null && (
          <line
            x1="0"
            y1={threshold60Y}
            x2={width}
            y2={threshold60Y}
            stroke="rgb(239, 68, 68)"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.4"
          />
        )}

        {interactive && (
          <ChartCrosshair
            x={hoveredIndex !== null ? points[hoveredIndex]?.x ?? null : null}
            y={hoveredIndex !== null ? points[hoveredIndex]?.y ?? null : null}
            width={width}
            height={height}
            showVertical={true}
            showHorizontal={true}
          />
        )}

        <path
          d={createPath(points)}
          fill="none"
          stroke="rgb(251, 191, 36)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {interactive && hoveredIndex !== null && points[hoveredIndex] && (
          <circle
            cx={points[hoveredIndex].x}
            cy={points[hoveredIndex].y}
            r="5"
            fill="rgb(251, 191, 36)"
            stroke="white"
            strokeWidth="2"
            className="pointer-events-none"
          />
        )}

        {showMinMax && (
          <text x={width - 5} y="12" textAnchor="end" className="fill-yellow-400 text-xs font-medium">
            {Math.round(max)} mph
          </text>
        )}
      </svg>

      {interactive && tooltip && (
        <div
          className="absolute pointer-events-none z-50"
          style={{
            left: Math.min(Math.max(tooltip.x - 50, 5), width - 105),
            top: Math.max(tooltip.y - 45, 5),
          }}
        >
          <div className="bg-mv-bg-primary/95 backdrop-blur-sm border border-white/20 rounded-lg px-2.5 py-1.5 shadow-xl">
            <div className="text-[10px] text-mv-text-muted">{tooltip.label}</div>
            <div className="flex items-center gap-1.5">
              <span className={clsx('font-semibold', getWindWarningColor(tooltip.value))}>
                {Math.round(tooltip.value)} mph
              </span>
              {tooltip.value >= 60 && <span className="text-[9px] text-red-400">Dangerous</span>}
              {tooltip.value >= 40 && tooltip.value < 60 && <span className="text-[9px] text-orange-400">High</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
