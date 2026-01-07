'use client';

import { useMemo, ReactNode } from 'react';
import { SoundingLevel, DerivedParameters } from '@/lib/soundings/types';

interface HodographProps {
  levels: SoundingLevel[];
  derived: DerivedParameters;
  surfaceHeight: number;
  size?: number;
}

// Hodograph - polar plot of wind vectors
const DEFAULT_SIZE = 300;
const MARGIN = 30;

// Height color bands (AGL in meters)
const HEIGHT_COLORS = [
  { maxHeight: 1000, color: '#ef4444' },   // 0-1km: Red
  { maxHeight: 3000, color: '#f97316' },   // 1-3km: Orange
  { maxHeight: 6000, color: '#22c55e' },   // 3-6km: Green
  { maxHeight: 9000, color: '#3b82f6' },   // 6-9km: Blue
  { maxHeight: 12000, color: '#a855f7' },  // 9-12km: Purple
];

function getHeightColor(heightAGL: number): string {
  for (const band of HEIGHT_COLORS) {
    if (heightAGL <= band.maxHeight) return band.color;
  }
  return HEIGHT_COLORS[HEIGHT_COLORS.length - 1].color;
}

export function Hodograph({
  levels,
  derived,
  surfaceHeight,
  size = DEFAULT_SIZE,
}: HodographProps) {
  const plotSize = size - 2 * MARGIN;
  const center = size / 2;
  const radius = plotSize / 2;

  // Maximum wind speed for scale
  const maxSpeed = useMemo(() => {
    const maxWind = Math.max(...levels.map((l) => l.wind_speed_kt), 40);
    return Math.ceil(maxWind / 20) * 20; // Round up to nearest 20
  }, [levels]);

  // Scale: knots to pixels
  const scale = radius / maxSpeed;

  // Convert wind dir/speed to u/v then to x/y
  const windToXY = (dir: number, speed: number): { x: number; y: number } => {
    const dirRad = (dir * Math.PI) / 180;
    const u = -speed * Math.sin(dirRad);
    const v = -speed * Math.cos(dirRad);
    // Meteorological convention: north is up, east is right
    return {
      x: u * scale,
      y: -v * scale, // SVG Y is inverted
    };
  };

  // Range rings
  const rings = useMemo(() => {
    const elements: ReactNode[] = [];
    const interval = maxSpeed <= 40 ? 10 : 20;

    for (let spd = interval; spd <= maxSpeed; spd += interval) {
      const r = spd * scale;
      elements.push(
        <circle
          key={`ring-${spd}`}
          cx={0}
          cy={0}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={spd === maxSpeed ? 1 : 0.5}
        />
      );
      // Label
      elements.push(
        <text
          key={`ring-label-${spd}`}
          x={r + 3}
          y={0}
          fill="#707080"
          fontSize={8}
          alignmentBaseline="middle"
        >
          {spd}
        </text>
      );
    }

    return elements;
  }, [maxSpeed, scale]);

  // Cardinal direction lines
  const cardinals = useMemo(() => {
    return (
      <>
        {/* N-S line */}
        <line
          x1={0}
          y1={-radius}
          x2={0}
          y2={radius}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={0.5}
        />
        {/* E-W line */}
        <line
          x1={-radius}
          y1={0}
          x2={radius}
          y2={0}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={0.5}
        />
        {/* Labels */}
        <text x={0} y={-radius - 5} textAnchor="middle" fill="#707080" fontSize={10}>N</text>
        <text x={0} y={radius + 12} textAnchor="middle" fill="#707080" fontSize={10}>S</text>
        <text x={radius + 8} y={0} textAnchor="start" alignmentBaseline="middle" fill="#707080" fontSize={10}>E</text>
        <text x={-radius - 8} y={0} textAnchor="end" alignmentBaseline="middle" fill="#707080" fontSize={10}>W</text>
      </>
    );
  }, [radius]);

  // Wind trace path
  const windTrace = useMemo(() => {
    const validLevels = levels
      .filter((l) => l.wind_speed_kt > 0 && !isNaN(l.wind_dir_deg))
      .sort((a, b) => b.pressure_mb - a.pressure_mb); // Surface first

    if (validLevels.length < 2) return null;

    // Build path with color segments
    const segments: ReactNode[] = [];

    for (let i = 0; i < validLevels.length - 1; i++) {
      const l1 = validLevels[i];
      const l2 = validLevels[i + 1];

      const p1 = windToXY(l1.wind_dir_deg, l1.wind_speed_kt);
      const p2 = windToXY(l2.wind_dir_deg, l2.wind_speed_kt);

      const heightAGL = l1.height_m - surfaceHeight;
      const color = getHeightColor(heightAGL);

      segments.push(
        <line
          key={`seg-${i}`}
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      );
    }

    // Add dots at key heights
    const keyHeights = [1000, 3000, 6000];
    keyHeights.forEach((h) => {
      const level = validLevels.find((l) => {
        const agl = l.height_m - surfaceHeight;
        return Math.abs(agl - h) < 500;
      });

      if (level) {
        const pos = windToXY(level.wind_dir_deg, level.wind_speed_kt);
        segments.push(
          <circle
            key={`dot-${h}`}
            cx={pos.x}
            cy={pos.y}
            r={4}
            fill={getHeightColor(h)}
            stroke="white"
            strokeWidth={1}
          />
        );
      }
    });

    return segments;
  }, [levels, surfaceHeight, scale]);

  // Storm motion vectors
  const stormMotion = useMemo(() => {
    if (!derived.storm_motion_right_spd) return null;

    const rightPos = windToXY(derived.storm_motion_right_dir, derived.storm_motion_right_spd);
    const leftPos = windToXY(derived.storm_motion_left_dir, derived.storm_motion_left_spd);
    const meanPos = windToXY(derived.storm_motion_mean_dir, derived.storm_motion_mean_spd);

    return (
      <>
        {/* Mean wind marker */}
        <circle
          cx={meanPos.x}
          cy={meanPos.y}
          r={5}
          fill="none"
          stroke="#22d3ee"
          strokeWidth={2}
        />
        {/* Right-mover */}
        <g transform={`translate(${rightPos.x}, ${rightPos.y})`}>
          <polygon points="0,-6 5,6 -5,6" fill="#ef4444" stroke="white" strokeWidth={1} />
        </g>
        {/* Left-mover */}
        <g transform={`translate(${leftPos.x}, ${leftPos.y})`}>
          <polygon points="0,-6 5,6 -5,6" fill="#3b82f6" stroke="white" strokeWidth={1} />
        </g>
      </>
    );
  }, [derived, scale]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="w-full h-full"
    >
      {/* Background */}
      <rect x={0} y={0} width={size} height={size} fill="#0a0a0f" rx={8} />

      {/* Plot area */}
      <g transform={`translate(${center}, ${center})`}>
        {/* Range rings */}
        {rings}

        {/* Cardinal lines */}
        {cardinals}

        {/* Wind trace */}
        {windTrace}

        {/* Storm motion */}
        {stormMotion}

        {/* Origin dot */}
        <circle cx={0} cy={0} r={3} fill="#ffffff" />
      </g>

      {/* Legend */}
      <g transform={`translate(${size - 70}, ${10})`}>
        <rect x={0} y={0} width={60} height={75} fill="rgba(0,0,0,0.5)" rx={4} />
        {HEIGHT_COLORS.slice(0, 4).map((band, i) => (
          <g key={i} transform={`translate(5, ${10 + i * 15})`}>
            <rect x={0} y={0} width={10} height={10} fill={band.color} rx={2} />
            <text x={15} y={8} fill="#b0b0c0" fontSize={8}>
              {i === 0 ? '0-1' : i === 1 ? '1-3' : i === 2 ? '3-6' : '6-9'}km
            </text>
          </g>
        ))}
      </g>

      {/* Speed label */}
      <text x={center} y={size - 5} textAnchor="middle" fill="#707080" fontSize={9}>
        Speed (kt)
      </text>
    </svg>
  );
}

export default Hodograph;
