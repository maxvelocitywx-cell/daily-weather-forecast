'use client';

import clsx from 'clsx';

const RISK_LEVELS = [
  { score: 1, label: 'Very Quiet', color: 'bg-emerald-500' },
  { score: 2, label: 'Quiet', color: 'bg-lime-500' },
  { score: 3, label: 'Marginal', color: 'bg-yellow-400' },
  { score: 4, label: 'Active', color: 'bg-orange-400' },
  { score: 5, label: 'Elevated', color: 'bg-red-400' },
  { score: 6, label: 'High', color: 'bg-red-500' },
  { score: 7, label: 'Significant', color: 'bg-red-600' },
  { score: 8, label: 'Major', color: 'bg-red-800' },
  { score: 9, label: 'Severe', color: 'bg-purple-700' },
  { score: 10, label: 'Extreme', color: 'bg-gray-900 border border-red-600' },
];

export default function RiskScale() {
  return (
    <div className="card p-6">
      <h3 className="text-sm font-semibold text-mv-text-dimmed uppercase tracking-wider mb-4">
        Max Velocity Risk Scale
      </h3>

      <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
        {RISK_LEVELS.map((level) => (
          <div key={level.score} className="flex flex-col items-center gap-1.5">
            <div
              className={clsx(
                'w-8 h-8 rounded-lg flex items-center justify-center',
                'text-xs font-bold',
                level.color,
                level.score >= 3 && level.score <= 2 ? 'text-gray-900' : 'text-white'
              )}
            >
              {level.score}
            </div>
            <span className="text-2xs text-mv-text-muted text-center leading-tight">
              {level.label}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-white/5">
        <p className="text-xs text-mv-text-muted">
          Risk scores are calculated based on expected snow, rain, wind, and temperature impacts.
          Scores 6+ indicate significant weather that may disrupt travel or daily activities.
        </p>
      </div>
    </div>
  );
}

export function RiskScaleCompact() {
  return (
    <div className="flex items-center gap-0.5">
      {RISK_LEVELS.map((level) => (
        <div
          key={level.score}
          className={clsx('w-4 h-2 first:rounded-l last:rounded-r', level.color)}
          title={`${level.score}: ${level.label}`}
        />
      ))}
    </div>
  );
}
