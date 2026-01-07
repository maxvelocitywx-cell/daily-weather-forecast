'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { formatDayLabel, formatDayLabelWithDate } from '@/lib/formatDayLabel';
import { ChartCrosshair } from './InteractiveChartShell';

interface DayRisk {
  day: number;
  risk: number;
  label?: string;
}

interface National7DayBarGraphProps {
  data: DayRisk[];
  width?: number;
  height?: number;
  onDayClick?: (day: number) => void;
  selectedDay?: number;
}

interface TooltipData {
  x: number;
  y: number;
  dayIndex: number;
  risk: number;
  label: string;
  date: string;
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

function getRiskGradient(risk: number): [string, string] {
  if (risk <= 2) return ['#10b981', '#059669'];
  if (risk <= 3) return ['#84cc16', '#65a30d'];
  if (risk <= 4) return ['#eab308', '#ca8a04'];
  if (risk <= 5) return ['#f97316', '#ea580c'];
  if (risk <= 6) return ['#ef4444', '#dc2626'];
  if (risk <= 7) return ['#dc2626', '#b91c1c'];
  if (risk <= 8) return ['#b91c1c', '#991b1b'];
  if (risk <= 9) return ['#9333ea', '#7c3aed'];
  return ['#171717', '#000000'];
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

export function National7DayBarGraph({
  data,
  width = 400,
  height = 180,
  onDayClick,
  selectedDay,
}: National7DayBarGraphProps) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { bars } = useMemo(() => {
    const maxRisk = 10;
    const barWidth = width / data.length;
    const padding = 30;
    const bottomPadding = 38;

    const bs = data.map((d, i) => {
      const [color1, color2] = getRiskGradient(d.risk);
      const dayInfo = formatDayLabelWithDate(d.day);
      return {
        x: i * barWidth + barWidth * 0.1,
        width: barWidth * 0.8,
        height: (d.risk / maxRisk) * (height - padding - bottomPadding),
        risk: d.risk,
        day: d.day,
        label: dayInfo.label,
        date: dayInfo.date,
        gradientId: `national-bar-gradient-${i}`,
        color1,
        color2,
        centerX: i * barWidth + barWidth / 2,
      };
    });

    return { bars: bs };
  }, [data, width, height]);

  const handleMouseEnter = useCallback((index: number, bar: typeof bars[0]) => {
    if (isPinned) return;
    setHoveredBar(index);
    setTooltip({
      x: bar.centerX,
      y: height - 38 - bar.height - 40,
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
      onDayClick(bar.day);
    }
    if (tooltip && tooltip.dayIndex === index && isPinned) {
      setIsPinned(false);
      setTooltip(null);
      setHoveredBar(null);
    } else {
      setIsPinned(true);
      setTooltip({
        x: bar.centerX,
        y: height - 38 - bar.height - 40,
        dayIndex: index,
        risk: bar.risk,
        label: bar.label,
        date: bar.date,
      });
      setHoveredBar(index);
    }
  }, [onDayClick, tooltip, isPinned, height]);

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
        {/* Gradient definitions */}
        <defs>
          {bars.map((bar) => (
            <linearGradient
              key={bar.gradientId}
              id={bar.gradientId}
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor={bar.color1} />
              <stop offset="100%" stopColor={bar.color2} />
            </linearGradient>
          ))}
        </defs>

        {/* Grid lines */}
        {[2, 4, 6, 8].map((level) => {
          const y = height - 38 - (level / 10) * (height - 68);
          return (
            <g key={level}>
              <line
                x1="0"
                y1={y}
                x2={width}
                y2={y}
                stroke="rgba(255, 255, 255, 0.05)"
                strokeWidth="1"
              />
              <text
                x="-4"
                y={y + 4}
                textAnchor="end"
                className="fill-mv-text-muted text-[9px]"
              >
                {level}
              </text>
            </g>
          );
        })}

        {/* Crosshair */}
        <ChartCrosshair
          x={hoveredBar !== null ? bars[hoveredBar].centerX : null}
          y={null}
          width={width}
          height={height - 38}
          showVertical={true}
          showHorizontal={false}
        />

        {/* Bars */}
        {bars.map((bar, i) => {
          const isSelected = selectedDay === bar.day;
          const isHovered = hoveredBar === i;
          const isDimmed = hoveredBar !== null && !isHovered;

          return (
            <g
              key={i}
              className="cursor-pointer"
              onMouseEnter={() => handleMouseEnter(i, bar)}
              onMouseLeave={handleMouseLeave}
              onClick={() => handleClick(i, bar)}
            >
              {/* Hit area */}
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
                y={height - 38 - bar.height}
                width={bar.width}
                height={bar.height}
                fill={`url(#${bar.gradientId})`}
                rx="4"
                className={clsx(
                  'transition-all duration-150',
                  isHovered && 'filter brightness-110',
                  isSelected && 'stroke-white stroke-2',
                  isDimmed && 'opacity-50'
                )}
                style={{
                  opacity: isDimmed ? 0.5 : isHovered ? 1 : 0.85,
                  transform: isHovered ? 'scaleY(1.02)' : 'scaleY(1)',
                  transformOrigin: 'bottom',
                }}
              />

              {/* Hover highlight ring */}
              {isHovered && (
                <rect
                  x={bar.x - 2}
                  y={height - 38 - bar.height - 2}
                  width={bar.width + 4}
                  height={bar.height + 4}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.3)"
                  strokeWidth="2"
                  rx="6"
                  className="pointer-events-none"
                />
              )}

              {/* Risk value on bar */}
              <text
                x={bar.x + bar.width / 2}
                y={height - 38 - bar.height - 6}
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
                y={height - 22}
                textAnchor="middle"
                className={clsx(
                  'text-[10px] font-semibold transition-all',
                  isSelected ? 'fill-mv-accent-blue' : 'fill-mv-text-primary',
                  isDimmed && 'opacity-50'
                )}
              >
                {bar.label}
              </text>

              {/* Date label */}
              <text
                x={bar.x + bar.width / 2}
                y={height - 8}
                textAnchor="middle"
                className={clsx(
                  'text-[9px] transition-all',
                  isSelected ? 'fill-mv-accent-blue' : 'fill-mv-text-muted',
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
                x
              </button>
            )}
            <div className="text-xs text-mv-text-muted mb-1">
              {tooltip.label} - {tooltip.date}
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
            <div className="text-[10px] text-mv-text-muted mt-1">
              National Average Risk
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

export function National7DayBarGraphCompact({
  data,
  onDayClick,
  selectedDay,
}: {
  data: DayRisk[];
  onDayClick?: (day: number) => void;
  selectedDay?: number;
}) {
  return (
    <div className="flex items-end gap-1 h-20">
      {data.map((d) => {
        const isSelected = selectedDay === d.day;
        const heightPercent = (d.risk / 10) * 100;
        const dayInfo = formatDayLabelWithDate(d.day);

        return (
          <button
            key={d.day}
            onClick={() => onDayClick?.(d.day)}
            className="flex-1 flex flex-col items-center gap-0.5"
          >
            <div
              className="w-full rounded-t transition-all"
              style={{
                height: `${heightPercent}%`,
                backgroundColor: getRiskColor(d.risk),
                opacity: isSelected ? 1 : 0.7,
                boxShadow: isSelected ? '0 0 8px rgba(59, 130, 246, 0.5)' : 'none',
              }}
            />
            <span
              className={`text-[9px] font-semibold leading-tight ${
                isSelected ? 'text-mv-accent-blue' : 'text-mv-text-primary'
              }`}
            >
              {dayInfo.label.slice(0, 3)}
            </span>
            <span
              className={`text-[8px] leading-tight ${
                isSelected ? 'text-mv-accent-blue' : 'text-mv-text-muted'
              }`}
            >
              {dayInfo.date}
            </span>
          </button>
        );
      })}
    </div>
  );
}
