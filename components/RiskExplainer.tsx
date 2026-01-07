'use client';

import { RiskExplainPayload, RiskDriver, RiskBreakdownItem } from '@/lib/types';
import clsx from 'clsx';

interface RiskExplainerProps {
  explain: RiskExplainPayload;
  compact?: boolean;
}

export function RiskExplainer({ risks, compact = false }: { risks: any; compact?: boolean }) {
  // Handle case where we receive simplified risk data
  if (!risks) return null;

  // If we get the new simplified format, convert it
  const explain = risks.summary_text ? risks : {
    summary_text: `Risk driven by ${Object.entries(risks).filter(([k, v]) => typeof v === 'number' && v > 0).map(([k]) => k).join(', ') || 'various factors'}`,
    top_drivers: Object.entries(risks)
      .filter(([key, value]) => typeof value === 'number' && value > 0)
      .map(([key, value]) => ({
        hazard: key.charAt(0).toUpperCase() + key.slice(1),
        score: value as number,
        rawValue: Math.round(value as number),
        unit: ''
      }))
      .slice(0, 3),
    breakdown: []
  };

  return <RiskExplainerInner explain={explain} compact={compact} />;
}

function RiskExplainerInner({ explain, compact = false }: RiskExplainerProps) {
  if (!explain) return null;

  if (compact) {
    return (
      <div className="text-sm text-mv-text-secondary">
        {explain.summary_text}
      </div>
    );
  }

  return (
    <div className="mt-4 p-4 bg-mv-bg-tertiary/30 rounded-xl border border-white/5">
      {/* Summary */}
      <p className="text-sm text-mv-text-secondary leading-relaxed mb-4">
        {explain.summary_text}
      </p>

      {/* Top Drivers */}
      {explain.top_drivers && explain.top_drivers.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-mv-text-dimmed uppercase tracking-wider mb-2">
            Key Drivers
          </h4>
          <div className="flex flex-wrap gap-2">
            {explain.top_drivers.map((driver, i) => (
              <DriverChip key={i} driver={driver} />
            ))}
          </div>
        </div>
      )}

      {/* Breakdown */}
      {explain.breakdown && explain.breakdown.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-mv-text-dimmed uppercase tracking-wider mb-2">
            Risk Breakdown
          </h4>
          <div className="space-y-2">
            {explain.breakdown.map((item, i) => (
              <BreakdownBar key={i} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DriverChip({ driver }: { driver: RiskDriver }) {
  const colorClass = driver.score >= 6
    ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : driver.score >= 4
    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border',
        colorClass
      )}
    >
      <span>{driver.hazard}</span>
      <span className="opacity-70 font-mono">
        {driver.rawValue}{driver.unit}
      </span>
    </span>
  );
}

function BreakdownBar({ item }: { item: RiskBreakdownItem }) {
  const percentage = Math.min(100, Math.max(0, (item.contribution ?? 0) * 10));

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-mv-text-secondary">{item.category}</span>
        <span className="text-mv-text-muted">{((item.contribution ?? 0) * 10).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-mv-bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-mv-accent-blue rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export function RiskExplainerCompact({ explain }: { explain: RiskExplainPayload }) {
  if (!explain?.top_drivers?.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {explain.top_drivers.slice(0, 3).map((driver, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-mv-bg-tertiary/50 text-xs text-mv-text-muted"
        >
          {driver.hazard}: {driver.rawValue}{driver.unit}
        </span>
      ))}
    </div>
  );
}
