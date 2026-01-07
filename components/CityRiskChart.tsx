'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { CityDayForecast } from '@/lib/types';
import { formatDayLabelWithDate } from '@/lib/formatDayLabel';
import { ChartCrosshair } from './InteractiveChartShell';

interface CityRiskChartProps {
  days: CityDayForecast[];
  width?: number;
  height?: number;
  onDayClick?: (dayIndex: number) => void;
  selectedDay?: number;
}

function getRiskColor(risk: number): string {
  if (risk <= 2) return '#10b981'; // emerald
  if (risk <= 3) return '#84cc16'; // lime
  if (risk <= 4) return '#eab308'; // yellow
  if (risk <= 5) return '#f97316'; // orange
  if (risk <= 6) return '#ef4444'; // red
  if (risk <= 7) return '#dc2626'; // red-600
  if (risk <= 8) return '#b91c1c'; // red-700
  if (risk <= 9) return '#9333ea'; // purple
  return '#000000'; // black
}

function getRiskLabel(risk: number): string {
  if (risk <= 2) return 'Very Low';
  if (risk <= 3) return 'Low';
  if (risk <= 4) return 'Low-Moderate';
  if (risk <= 5) return 'Moderate';
  if (risk <= 6) return 'Moderate-High';
  if (risk <= 7) return 'High';
  if (risk <= 8) return 'Very High';
  if (risk <= 9) return 'Extreme';
  return 'Catastrophic';
}

interface TooltipData {
  x: number;
  y: number;
  dayIndex: number;
  risk: number;
  label: string;
  date: string;
}

export function CityRiskChart({
  days,
  width = 320,
  height = 140,
  onDayClick,
  selectedDay,
}: CityRiskChartProps) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { bars, maxRisk } = useMemo(() => {
    const maxR = Math.max(...days.map((d) => d.risk), 5);
    const barWidth = width / days.length;
    const bottomPadding = 34;

    const bs = days.map((day, i) => {
      const dayInfo = formatDayLabelWithDate(i + 1);
      return {
        x: i * barWidth + barWidth * 0.15,
        width: barWidth * 0.7,
        height: (day.risk / maxR) * (height - bottomPadding - 10),
        risk: day.risk,
        label: dayInfo.label,
        date: dayInfo.date,
        centerX: i * barWidth + barWidth / 2,
      };
    });

    return { bars: bs, maxRisk: maxR };
  }, [days, width, height]);

  const handleMouseEnter = useCallback((index: number, bar: typeof bars[0]) => {
    if (isPinned) return;
    setHoveredBar(index);
    setTooltip({
      x: bar.centerX,
      y: height - 34 - bar.height - 30,
      dayIndex: index,
      risk: bar.risk,
      label: bar.label,
      date: bar.date,
    });
  }, [isPinned, height]);

  const handleMouseLeave = useCallback(() => {
    if (isPinned) return;
    setHoveredBar(null);
    setTooltip(null);
  }, [isPinned]);

  const handleClick = useCallback((index: number, bar: typeof bars[0]) => {
    if (onDayClick) {
      onDayClick(index + 1);
    }
    // Toggle pin state
    if (tooltip && tooltip.dayIndex === index && isPinned) {
      setIsPinned(false);
      setTooltip(null);
      setHoveredBar(null);
    } else {
      setIsPinned(true);
      setTooltip({
        x: bar.centerX,
        y: height - 34 - bar.height - 30,
        dayIndex: index,
        risk: bar.risk,
        label: bar.label,
        date: bar.date,
      });
      setHoveredBar(index);
    }
  }, [onDayClick, tooltip, isPinned, height]);

  // Handle escape key to unpin
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isPinned) {
      setIsPinned(false);
      setTooltip(null);
      setHoveredBar(null);
    }
  }, [isPinned]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        {/* Grid lines */}
        {[2, 4, 6, 8, 10].map((level) => {
          const y = height - 34 - (level / 10) * (height - 44);
          return (
            <line
              key={level}
              x1="0"
              y1={y}
              x2={width}
              y2={y}
              stroke="rgba(255, 255, 255, 0.05)"
              strokeWidth="1"
            />
          );
        })}

        {/* Crosshair */}
        <ChartCrosshair
          x={hoveredBar !== null ? bars[hoveredBar].centerX : null}
          y={null}
          width={width}
          height={height - 34}
          showVertical={true}
          showHorizontal={false}
        />

        {/* Bars */}
        {bars.map((bar, i) => {
          const isHovered = hoveredBar === i;
          const isSelected = selectedDay === i + 1;
          const isDimmed = hoveredBar !== null && !isHovered;

          return (
            <g
              key={i}
              className="cursor-pointer"
              onMouseEnter={() => handleMouseEnter(i, bar)}
              onMouseLeave={handleMouseLeave}
              onClick={() => handleClick(i, bar)}
            >
              {/* Hit area (larger for easier interaction) */}
              <rect
                x={bar.x - 5}
                y={0}
                width={bar.width + 10}
                height={height}
                fill="transparent"
              />

              {/* Bar */}
              <rect
                x={bar.x}
                y={height - 34 - bar.height}
                width={bar.width}
                height={bar.height}
                fill={getRiskColor(bar.risk)}
                rx="4"
                className={clsx(
                  'transition-all duration-150',
                  isHovered && 'filter brightness-110',
                  isSelected && 'stroke-white stroke-2',
                  isDimmed && 'opacity-50'
                )}
                style={{
                  opacity: isDimmed ? 0.5 : isHovered ? 1 : 0.8,
                  transform: isHovered ? 'scaleY(1.02)' : 'scaleY(1)',
                  transformOrigin: 'bottom',
                }}
              />

              {/* Hover highlight ring */}
              {isHovered && (
                <rect
                  x={bar.x - 2}
                  y={height - 34 - bar.height - 2}
                  width={bar.width + 4}
                  height={bar.height + 4}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.3)"
                  strokeWidth="2"
                  rx="6"
                  className="pointer-events-none"
                />
              )}

              {/* Risk label on bar */}
              <text
                x={bar.x + bar.width / 2}
                y={height - 34 - bar.height - 5}
                textAnchor="middle"
                className={clsx(
                  'fill-mv-text-primary text-xs font-bold transition-opacity',
                  isDimmed && 'opacity-50'
                )}
              >
                {bar.risk >= 0 ? bar.risk.toFixed(1) : 'N/A'}
              </text>

              {/* Day label */}
              <text
                x={bar.x + bar.width / 2}
                y={height - 18}
                textAnchor="middle"
                className={clsx(
                  'text-[10px] font-semibold transition-all',
                  isSelected ? 'fill-mv-accent' : 'fill-mv-text-primary',
                  isDimmed && 'opacity-50'
                )}
              >
                {bar.label}
              </text>

              {/* Date label */}
              <text
                x={bar.x + bar.width / 2}
                y={height - 5}
                textAnchor="middle"
                className={clsx(
                  'text-[9px] transition-all',
                  isSelected ? 'fill-mv-accent' : 'fill-mv-text-muted',
                  isDimmed && 'opacity-50'
                )}
              >
                {bar.date}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className={clsx(
            'absolute pointer-events-none z-50 transition-all duration-150',
            isPinned && 'pointer-events-auto'
          )}
          style={{
            left: Math.min(Math.max(tooltip.x - 70, 10), width - 150),
            top: Math.max(tooltip.y - 10, 5),
          }}
        >
          <div
            className={clsx(
              'bg-mv-bg-primary/95 backdrop-blur-sm border rounded-lg p-2.5 shadow-xl min-w-[130px]',
              isPinned ? 'border-mv-accent/50' : 'border-white/20'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {isPinned && (
              <button
                onClick={() => {
                  setIsPinned(false);
                  setTooltip(null);
                  setHoveredBar(null);
                }}
                className="absolute -top-2 -right-2 w-5 h-5 bg-mv-accent rounded-full flex items-center justify-center text-white text-xs hover:bg-mv-accent/80"
                title="Unpin (Esc)"
              >
                ×
              </button>
            )}
            <div className="text-xs text-mv-text-muted mb-1">
              {tooltip.label} • {tooltip.date}
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getRiskColor(tooltip.risk) }}
              />
              <span className="text-mv-text-primary font-semibold">
                {tooltip.risk >= 0 ? tooltip.risk.toFixed(1) : 'N/A'}
              </span>
              <span className="text-xs text-mv-text-muted">
                {tooltip.risk >= 0 ? getRiskLabel(tooltip.risk) : 'No data'}
              </span>
            </div>
            {!isPinned && (
              <div className="text-[10px] text-mv-text-muted mt-1.5 pt-1.5 border-t border-white/10">
                Click to pin
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CityRiskSparklineProps {
  days: { risk: number }[];
  width?: number;
  height?: number;
  showTooltip?: boolean;
}

export function CityRiskSparkline({
  days,
  width = 100,
  height = 24,
  showTooltip = false,
}: CityRiskSparklineProps) {
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  const points = useMemo(() => {
    const maxRisk = 10;
    const padding = 2;

    return days.map((day, i) => ({
      x: days.length > 1 ? (i / (days.length - 1)) * width : width / 2,
      y: padding + ((maxRisk - day.risk) / maxRisk) * (height - 2 * padding),
      risk: day.risk,
    }));
  }, [days, width, height]);

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  return (
    <div className="relative inline-block">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        {/* Line path */}
        <path
          d={pathD}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={clsx(
            'transition-opacity',
            hoveredPoint !== null && 'opacity-50'
          )}
        />

        {/* Dots at each point */}
        {points.map((p, i) => (
          <g key={i}>
            {/* Larger hit area */}
            {showTooltip && (
              <circle
                cx={p.x}
                cy={p.y}
                r="8"
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredPoint(i)}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            )}
            {/* Visible dot */}
            <circle
              cx={p.x}
              cy={p.y}
              r={hoveredPoint === i ? 4 : 2}
              fill={getRiskColor(days[i].risk)}
              className="transition-all duration-150"
              style={{
                filter: hoveredPoint === i ? 'brightness(1.2)' : 'none',
              }}
            />
          </g>
        ))}
      </svg>

      {/* Mini tooltip */}
      {showTooltip && hoveredPoint !== null && (
        <div
          className="absolute -top-8 bg-mv-bg-primary/95 border border-white/20 rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap z-50 pointer-events-none"
          style={{
            left: points[hoveredPoint].x,
            transform: 'translateX(-50%)',
          }}
        >
          <span className="text-mv-text-muted">Day {hoveredPoint + 1}:</span>{' '}
          <span className="font-medium" style={{ color: getRiskColor(days[hoveredPoint].risk) }}>
            {days[hoveredPoint].risk.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}
