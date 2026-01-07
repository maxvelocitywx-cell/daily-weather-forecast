'use client';

import { useMemo, ReactNode } from 'react';
import { SoundingLevel, DerivedParameters } from '@/lib/soundings/types';

interface SkewTLogPProps {
  levels: SoundingLevel[];
  derived: DerivedParameters;
  width?: number;
  height?: number;
}

// Skew-T / Log-P Diagram Component
// Renders temperature and dewpoint profiles on a skewed temperature axis

const DEFAULT_SIZE = 400;
const MARGIN = { top: 20, right: 40, bottom: 40, left: 50 };

// Pressure range (bottom to top)
const P_BOTTOM = 1000;
const P_TOP = 200;

// Temperature range in Celsius (at 1000mb reference)
const T_LEFT = -40;
const T_RIGHT = 50;

// Skew angle in degrees
const SKEW_ANGLE = 45;

export function SkewTLogP({
  levels,
  derived,
  width = DEFAULT_SIZE,
  height = DEFAULT_SIZE,
}: SkewTLogPProps) {
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;

  // Convert pressure to Y coordinate (log scale)
  const pToY = (p: number): number => {
    const logP = Math.log(p);
    const logTop = Math.log(P_TOP);
    const logBottom = Math.log(P_BOTTOM);
    return ((logP - logTop) / (logBottom - logTop)) * plotHeight;
  };

  // Convert temperature to X coordinate (skewed)
  const tToX = (t: number, p: number): number => {
    // Skew factor based on pressure
    const y = pToY(p);
    const skewOffset = (y / plotHeight) * plotWidth * Math.tan((SKEW_ANGLE * Math.PI) / 180);
    const tNorm = (t - T_LEFT) / (T_RIGHT - T_LEFT);
    return tNorm * plotWidth - skewOffset;
  };

  // Generate background grid lines
  const gridLines = useMemo(() => {
    const lines: ReactNode[] = [];

    // Pressure levels (isobars)
    const pressureLevels = [1000, 925, 850, 700, 500, 400, 300, 200];
    pressureLevels.forEach((p, i) => {
      const y = pToY(p);
      lines.push(
        <line
          key={`p-${p}`}
          x1={0}
          y1={y}
          x2={plotWidth}
          y2={y}
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={p === 500 ? 1 : 0.5}
        />
      );
      // Pressure labels
      lines.push(
        <text
          key={`p-label-${p}`}
          x={-5}
          y={y}
          textAnchor="end"
          alignmentBaseline="middle"
          fill="#707080"
          fontSize={9}
        >
          {p}
        </text>
      );
    });

    // Temperature lines (isotherms - skewed)
    for (let t = -40; t <= 50; t += 10) {
      const x1 = tToX(t, P_BOTTOM);
      const y1 = pToY(P_BOTTOM);
      const x2 = tToX(t, P_TOP);
      const y2 = pToY(P_TOP);

      lines.push(
        <line
          key={`t-${t}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={t === 0 ? 'rgba(100,200,255,0.3)' : 'rgba(255,255,255,0.07)'}
          strokeWidth={t === 0 ? 1.5 : 0.5}
        />
      );

      // Temperature labels at bottom
      if (t >= -30 && t <= 40) {
        lines.push(
          <text
            key={`t-label-${t}`}
            x={x1}
            y={plotHeight + 15}
            textAnchor="middle"
            fill="#707080"
            fontSize={9}
          >
            {t}°
          </text>
        );
      }
    }

    return lines;
  }, [plotWidth, plotHeight]);

  // Generate temperature and dewpoint traces
  const traces = useMemo(() => {
    const validLevels = levels
      .filter((l) => !isNaN(l.temp_c) && !isNaN(l.dewpoint_c) && l.pressure_mb >= P_TOP && l.pressure_mb <= P_BOTTOM)
      .sort((a, b) => b.pressure_mb - a.pressure_mb);

    if (validLevels.length < 2) return { tempPath: '', dewPath: '' };

    // Temperature trace
    const tempPoints = validLevels.map((l) => {
      const x = tToX(l.temp_c, l.pressure_mb);
      const y = pToY(l.pressure_mb);
      return `${x},${y}`;
    });

    // Dewpoint trace
    const dewPoints = validLevels.map((l) => {
      const x = tToX(l.dewpoint_c, l.pressure_mb);
      const y = pToY(l.pressure_mb);
      return `${x},${y}`;
    });

    return {
      tempPath: `M ${tempPoints.join(' L ')}`,
      dewPath: `M ${dewPoints.join(' L ')}`,
    };
  }, [levels]);

  // Wind barbs
  const windBarbs = useMemo(() => {
    const barbs: ReactNode[] = [];
    const displayLevels = [1000, 925, 850, 700, 500, 300, 200];

    levels.forEach((level) => {
      // Only show at standard levels
      const nearestStd = displayLevels.find((p) => Math.abs(level.pressure_mb - p) < 25);
      if (!nearestStd || level.wind_speed_kt < 1) return;

      const y = pToY(level.pressure_mb);
      const x = plotWidth + 15;

      // Simple wind barb representation
      const dir = level.wind_dir_deg;
      const speed = level.wind_speed_kt;

      // Rotate barb based on wind direction
      const rotation = dir + 180; // Barbs point into the wind

      barbs.push(
        <g
          key={`barb-${level.pressure_mb}`}
          transform={`translate(${x}, ${y}) rotate(${rotation})`}
        >
          {/* Staff */}
          <line x1={0} y1={0} x2={0} y2={-15} stroke="#b0b0c0" strokeWidth={1} />
          {/* Speed pennants */}
          {speed >= 50 && <polygon points="0,-15 8,-12 0,-9" fill="#b0b0c0" />}
          {speed >= 10 && speed < 50 && (
            <line x1={0} y1={-13} x2={6} y2={-10} stroke="#b0b0c0" strokeWidth={1} />
          )}
          {speed >= 5 && speed < 10 && (
            <line x1={0} y1={-13} x2={3} y2={-11} stroke="#b0b0c0" strokeWidth={1} />
          )}
        </g>
      );
    });

    return barbs;
  }, [levels, plotWidth]);

  // LCL, LFC, EL markers
  const markers = useMemo(() => {
    const marks: ReactNode[] = [];

    if (derived.lcl_pressure_mb > 0) {
      const y = pToY(derived.lcl_pressure_mb);
      marks.push(
        <g key="lcl" transform={`translate(${plotWidth + 25}, ${y})`}>
          <circle r={4} fill="#22d3ee" />
          <text x={8} y={3} fill="#22d3ee" fontSize={8}>LCL</text>
        </g>
      );
    }

    if (derived.lfc_pressure_mb > 0) {
      const y = pToY(derived.lfc_pressure_mb);
      marks.push(
        <g key="lfc" transform={`translate(${plotWidth + 25}, ${y})`}>
          <circle r={4} fill="#f97316" />
          <text x={8} y={3} fill="#f97316" fontSize={8}>LFC</text>
        </g>
      );
    }

    if (derived.el_pressure_mb > 0) {
      const y = pToY(derived.el_pressure_mb);
      marks.push(
        <g key="el" transform={`translate(${plotWidth + 25}, ${y})`}>
          <circle r={4} fill="#a855f7" />
          <text x={8} y={3} fill="#a855f7" fontSize={8}>EL</text>
        </g>
      );
    }

    return marks;
  }, [derived, plotWidth]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
    >
      <defs>
        <clipPath id="plot-clip">
          <rect x={0} y={0} width={plotWidth} height={plotHeight} />
        </clipPath>
      </defs>

      <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
        {/* Background */}
        <rect
          x={0}
          y={0}
          width={plotWidth}
          height={plotHeight}
          fill="#0a0a0f"
          stroke="rgba(255,255,255,0.1)"
        />

        {/* Grid lines */}
        <g clipPath="url(#plot-clip)">{gridLines}</g>

        {/* Temperature and dewpoint traces */}
        <g clipPath="url(#plot-clip)">
          {traces.dewPath && (
            <path
              d={traces.dewPath}
              fill="none"
              stroke="#22c55e"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {traces.tempPath && (
            <path
              d={traces.tempPath}
              fill="none"
              stroke="#ef4444"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>

        {/* Wind barbs */}
        {windBarbs}

        {/* Level markers */}
        {markers}

        {/* Axis labels */}
        <text
          x={plotWidth / 2}
          y={plotHeight + 32}
          textAnchor="middle"
          fill="#707080"
          fontSize={10}
        >
          Temperature (°C)
        </text>
        <text
          x={-plotHeight / 2}
          y={-35}
          textAnchor="middle"
          fill="#707080"
          fontSize={10}
          transform="rotate(-90)"
        >
          Pressure (mb)
        </text>
      </g>

      {/* Legend */}
      <g transform={`translate(${MARGIN.left + 10}, ${MARGIN.top + 10})`}>
        <rect x={0} y={0} width={80} height={50} fill="rgba(0,0,0,0.5)" rx={4} />
        <line x1={5} y1={15} x2={25} y2={15} stroke="#ef4444" strokeWidth={2} />
        <text x={30} y={18} fill="#b0b0c0" fontSize={9}>Temp</text>
        <line x1={5} y1={30} x2={25} y2={30} stroke="#22c55e" strokeWidth={2} />
        <text x={30} y={33} fill="#b0b0c0" fontSize={9}>Dewpt</text>
      </g>
    </svg>
  );
}

export default SkewTLogP;
