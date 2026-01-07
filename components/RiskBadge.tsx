'use client';

import { RiskLevel } from '@/lib/types';
import clsx from 'clsx';

interface RiskBadgeProps {
  score: number;
  level: RiskLevel;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  regionName?: string;
  riskLabel?: string;
}

// Color scheme matching the Max Velocity Risk Scale
function getRiskColors(score: number): {
  gradient: string;
  glow: string;
  text: string;
  border: string;
  ring: string;
} {
  // Score 10: Extreme - black with red border/glow
  if (score >= 9.5) {
    return {
      gradient: 'from-gray-900 via-gray-900 to-black',
      glow: 'shadow-[0_0_20px_rgba(220,38,38,0.6),0_0_40px_rgba(220,38,38,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]',
      text: 'text-white',
      border: 'border-red-600',
      ring: 'ring-red-600/50',
    };
  }
  // Score 9: Severe - purple
  if (score >= 8.5) {
    return {
      gradient: 'from-purple-700 via-purple-800 to-purple-900',
      glow: 'shadow-[0_0_20px_rgba(147,51,234,0.5),0_0_40px_rgba(147,51,234,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]',
      text: 'text-white',
      border: 'border-purple-500/50',
      ring: 'ring-purple-500/30',
    };
  }
  // Score 8: Major - dark red
  if (score >= 7.5) {
    return {
      gradient: 'from-red-800 via-red-800 to-red-900',
      glow: 'shadow-[0_0_20px_rgba(185,28,28,0.5),0_0_40px_rgba(185,28,28,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]',
      text: 'text-white',
      border: 'border-red-600/50',
      ring: 'ring-red-700/30',
    };
  }
  // Score 7: Significant - red-600/700
  if (score >= 6.5) {
    return {
      gradient: 'from-red-600 via-red-600 to-red-700',
      glow: 'shadow-[0_0_15px_rgba(220,38,38,0.5),0_0_30px_rgba(220,38,38,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]',
      text: 'text-white',
      border: 'border-red-500/50',
      ring: 'ring-red-500/30',
    };
  }
  // Score 6: High - red-500/600
  if (score >= 5.5) {
    return {
      gradient: 'from-red-500 via-red-500 to-red-600',
      glow: 'shadow-[0_0_15px_rgba(239,68,68,0.5),0_0_30px_rgba(239,68,68,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]',
      text: 'text-white',
      border: 'border-red-400/50',
      ring: 'ring-red-400/30',
    };
  }
  // Score 5: Elevated - red-400/500
  if (score >= 4.5) {
    return {
      gradient: 'from-red-400 via-red-400 to-red-500',
      glow: 'shadow-[0_0_15px_rgba(248,113,113,0.5),0_0_30px_rgba(248,113,113,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]',
      text: 'text-white',
      border: 'border-red-300/50',
      ring: 'ring-red-300/30',
    };
  }
  // Score 4: Active - orange
  if (score >= 3.5) {
    return {
      gradient: 'from-orange-400 via-orange-400 to-orange-500',
      glow: 'shadow-[0_0_15px_rgba(251,146,60,0.4),0_0_25px_rgba(251,146,60,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]',
      text: 'text-white',
      border: 'border-orange-300/50',
      ring: 'ring-orange-400/30',
    };
  }
  // Score 3: Marginal - yellow
  if (score >= 2.5) {
    return {
      gradient: 'from-yellow-400 via-yellow-400 to-yellow-500',
      glow: 'shadow-[0_0_12px_rgba(250,204,21,0.4),0_0_20px_rgba(250,204,21,0.2),inset_0_1px_0_rgba(255,255,255,0.3)]',
      text: 'text-gray-900',
      border: 'border-yellow-300/60',
      ring: 'ring-yellow-400/30',
    };
  }
  // Score 2: Quiet - lime
  if (score >= 1.5) {
    return {
      gradient: 'from-lime-500 via-lime-500 to-lime-600',
      glow: 'shadow-[0_0_12px_rgba(132,204,22,0.4),0_0_20px_rgba(132,204,22,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]',
      text: 'text-white',
      border: 'border-lime-400/50',
      ring: 'ring-lime-500/30',
    };
  }
  // Score 1: Very Quiet - emerald
  return {
    gradient: 'from-emerald-500 via-emerald-500 to-emerald-600',
    glow: 'shadow-[0_0_12px_rgba(16,185,129,0.4),0_0_20px_rgba(16,185,129,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]',
    text: 'text-white',
    border: 'border-emerald-400/50',
    ring: 'ring-emerald-500/30',
  };
}

// Get label from score (matching the Max Velocity Risk Scale)
function getRiskLabel(score: number): string {
  if (score >= 9.5) return 'EXTREME';
  if (score >= 8.5) return 'SEVERE';
  if (score >= 7.5) return 'MAJOR';
  if (score >= 6.5) return 'SIGNIFICANT';
  if (score >= 5.5) return 'HIGH';
  if (score >= 4.5) return 'ELEVATED';
  if (score >= 3.5) return 'ACTIVE';
  if (score >= 2.5) return 'MARGINAL';
  if (score >= 1.5) return 'QUIET';
  return 'VERY QUIET';
}

export { getRiskColors };

export function RiskBadge({
  score,
  size = 'md',
  showLabel = true,
  regionName,
  riskLabel,
}: Omit<RiskBadgeProps, 'level'>) {
  const colors = getRiskColors(score);
  const label = getRiskLabel(score);

  const ariaLabel = regionName
    ? `${regionName} risk: ${label} ${score.toFixed(1)}`
    : `Risk: ${label} ${score.toFixed(1)}`;

  if (size === 'xs') {
    // Extra small - compact futuristic pill
    return (
      <span
        className={clsx(
          'relative inline-flex items-center justify-center',
          'min-w-[36px] px-2 py-1 rounded-md',
          'bg-gradient-to-r',
          colors.gradient,
          colors.glow,
          colors.text,
          'text-[11px] font-bold tabular-nums tracking-wide',
          'border',
          colors.border,
          'transition-all duration-300 hover:scale-105'
        )}
        role="img"
        aria-label={ariaLabel}
      >
        <span className="relative z-10">{score.toFixed(1)}</span>
      </span>
    );
  }

  if (size === 'sm') {
    // Small - sleek badge with label
    return (
      <span
        className={clsx(
          'relative inline-flex items-center gap-2',
          'px-3 py-1.5 rounded-lg',
          'bg-gradient-to-r',
          colors.gradient,
          colors.glow,
          colors.text,
          'text-xs font-bold tracking-wide',
          'border',
          colors.border,
          'transition-all duration-300 hover:scale-105'
        )}
        role="img"
        aria-label={ariaLabel}
      >
        <span className="uppercase text-[10px] opacity-90">{label}</span>
        <span className="font-mono tabular-nums">{score.toFixed(1)}</span>
      </span>
    );
  }

  if (size === 'md') {
    // Medium - standard futuristic badge
    return (
      <div
        className={clsx(
          'relative inline-flex items-center gap-2.5',
          'px-4 py-2 rounded-xl',
          'bg-gradient-to-r',
          colors.gradient,
          colors.glow,
          colors.text,
          'text-sm font-bold tracking-wide',
          'border',
          colors.border,
          'ring-2',
          colors.ring,
          'transition-all duration-300 hover:scale-105'
        )}
        role="img"
        aria-label={ariaLabel}
      >
        {/* Animated pulse ring for high risk */}
        {score >= 6 && (
          <span
            className={clsx(
              'absolute inset-0 rounded-xl animate-ping opacity-20',
              'bg-gradient-to-r',
              colors.gradient
            )}
            style={{ animationDuration: '2s' }}
          />
        )}
        <span className="relative uppercase text-xs opacity-90 tracking-wider">{label}</span>
        <span className="relative font-mono text-base tabular-nums">{score.toFixed(1)}</span>
      </div>
    );
  }

  // Large - hero badge with dramatic styling
  return (
    <div className="flex flex-col items-center gap-2" role="img" aria-label={ariaLabel}>
      {riskLabel && (
        <span className="text-xs text-mv-text-dimmed font-medium uppercase tracking-widest">
          {riskLabel}
        </span>
      )}
      <div className="relative">
        {/* Outer glow ring */}
        {score >= 4 && (
          <div
            className={clsx(
              'absolute -inset-2 rounded-2xl opacity-30 blur-md',
              'bg-gradient-to-r',
              colors.gradient,
              score >= 6 && 'animate-pulse'
            )}
          />
        )}

        {/* Main badge */}
        <div
          className={clsx(
            'relative flex flex-col items-center justify-center',
            'w-24 h-24 rounded-2xl',
            'bg-gradient-to-br',
            colors.gradient,
            colors.glow,
            'border-2',
            colors.border,
            'ring-4',
            colors.ring,
            'transition-all duration-300 hover:scale-105'
          )}
        >
          {/* Score number */}
          <span className={clsx('font-mono text-3xl font-black tabular-nums', colors.text)}>
            {score.toFixed(1)}
          </span>

          {/* Label below score */}
          <span className={clsx('text-[10px] font-bold uppercase tracking-wider opacity-80 mt-0.5', colors.text)}>
            {label}
          </span>

          {/* Corner accent */}
          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white/30" />
          <div className="absolute bottom-1 left-1 w-1.5 h-1.5 rounded-full bg-white/20" />
        </div>

        {/* Animated ring for extreme risk */}
        {score >= 8 && (
          <div
            className={clsx(
              'absolute -inset-1 rounded-2xl border-2 animate-ping opacity-40',
              colors.border
            )}
            style={{ animationDuration: '1.5s' }}
          />
        )}
      </div>
    </div>
  );
}

// Inline variant for use in text - also futuristic
export function RiskBadgeInline({
  score,
  level,
}: {
  score: number;
  level: RiskLevel;
}) {
  const colors = getRiskColors(score);
  const label = getRiskLabel(score);

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md',
        'bg-gradient-to-r',
        colors.gradient,
        colors.text,
        'text-xs font-bold',
        'border',
        colors.border,
        'shadow-sm'
      )}
      role="img"
      aria-label={`${label} ${score.toFixed(1)}`}
    >
      <span className="uppercase text-[10px] opacity-90">{label}</span>
      <span className="font-mono tabular-nums">{score.toFixed(1)}</span>
    </span>
  );
}
