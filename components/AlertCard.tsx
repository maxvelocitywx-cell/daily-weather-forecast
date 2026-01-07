'use client';

import { useState } from 'react';

interface AlertData {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  effective: string;
  expires: string;
  ends: string | null;
  areaDesc: string;
  states: string[];
  populationFormatted: string;
  population: {
    total: number;
    totalFormatted: string;
    byState: Record<string, number>;
    byStateFormatted: Record<string, string>;
    topCounties: Array<{ fips: string; name: string; population: number }>;
  };
  score: number;
  hasGeometry: boolean;
  sender: string;
}

interface AlertCardProps {
  alert: AlertData;
  onViewMap?: (alert: AlertData) => void;
}

// Severity colors (neon accents)
const severityColors: Record<string, { bg: string; border: string; glow: string; text: string }> = {
  Extreme: {
    bg: 'bg-red-500/20',
    border: 'border-red-500/50',
    glow: 'shadow-[0_0_15px_rgba(239,68,68,0.4)]',
    text: 'text-red-400'
  },
  Severe: {
    bg: 'bg-orange-500/20',
    border: 'border-orange-500/50',
    glow: 'shadow-[0_0_15px_rgba(249,115,22,0.4)]',
    text: 'text-orange-400'
  },
  Moderate: {
    bg: 'bg-yellow-500/20',
    border: 'border-yellow-500/50',
    glow: 'shadow-[0_0_15px_rgba(234,179,8,0.4)]',
    text: 'text-yellow-400'
  },
  Minor: {
    bg: 'bg-cyan-500/20',
    border: 'border-cyan-500/50',
    glow: 'shadow-[0_0_15px_rgba(34,211,238,0.4)]',
    text: 'text-cyan-400'
  },
  Unknown: {
    bg: 'bg-gray-500/20',
    border: 'border-gray-500/50',
    glow: 'shadow-[0_0_15px_rgba(156,163,175,0.3)]',
    text: 'text-gray-400'
  }
};

// Event type accent colors
const eventColors: Record<string, string> = {
  'Tornado Warning': 'from-red-600 to-pink-600',
  'Tornado Emergency': 'from-red-700 to-rose-700',
  'Flash Flood Warning': 'from-green-500 to-emerald-600',
  'Flash Flood Emergency': 'from-green-600 to-teal-700',
  'Severe Thunderstorm Warning': 'from-orange-500 to-amber-600',
  'Hurricane Warning': 'from-purple-600 to-violet-700',
  'Blizzard Warning': 'from-blue-400 to-cyan-500',
  'Winter Storm Warning': 'from-blue-500 to-indigo-600',
  'Ice Storm Warning': 'from-cyan-400 to-blue-500',
  'High Wind Warning': 'from-amber-500 to-yellow-600',
  'Excessive Heat Warning': 'from-red-500 to-orange-600',
  'Red Flag Warning': 'from-red-600 to-amber-600'
};

function formatDateTime(isoString: string): { local: string; date: string } {
  const date = new Date(isoString);
  return {
    local: date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }),
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  };
}

function Chip({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'severity' | 'urgency' | 'certainty' | 'default' }) {
  const baseClasses = 'px-2 py-0.5 rounded-full text-xs font-medium backdrop-blur-sm';
  const variantClasses = {
    severity: 'bg-red-500/20 text-red-300 border border-red-500/30',
    urgency: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    certainty: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    default: 'bg-white/10 text-gray-300 border border-white/20'
  };
  return <span className={`${baseClasses} ${variantClasses[variant]}`}>{children}</span>;
}

export default function AlertCard({ alert, onViewMap }: AlertCardProps) {
  const [expanded, setExpanded] = useState(false);
  const colors = severityColors[alert.severity] || severityColors.Unknown;
  const gradientClass = eventColors[alert.event] || 'from-gray-600 to-gray-700';

  const effectiveTime = formatDateTime(alert.effective);
  const expiresTime = formatDateTime(alert.expires);

  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl
        bg-gradient-to-br from-gray-900/80 via-gray-900/60 to-gray-800/40
        backdrop-blur-xl border ${colors.border}
        transition-all duration-300 ease-out
        hover:scale-[1.01] hover:${colors.glow}
        ${expanded ? colors.glow : ''}
      `}
    >
      {/* Gradient accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${gradientClass}`} />

      {/* Main content */}
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h3 className={`text-lg font-bold ${colors.text} tracking-wide truncate`}>
              {alert.event}
            </h3>
            <p className="text-sm text-gray-400 mt-1 line-clamp-1">
              {alert.areaDesc}
            </p>
          </div>

          {/* Population badge */}
          <div className="flex-shrink-0 text-right">
            <div className="text-2xl font-bold text-white tracking-tight">
              {alert.populationFormatted}
            </div>
            <div className="text-xs text-gray-500 uppercase tracking-wider">affected</div>
          </div>
        </div>

        {/* Chips row */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Chip variant="severity">{alert.severity}</Chip>
          <Chip variant="urgency">{alert.urgency}</Chip>
          <Chip variant="certainty">{alert.certainty}</Chip>
        </div>

        {/* Time info */}
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Effective</div>
            <div className="text-gray-300">{effectiveTime.local}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Expires</div>
            <div className="text-gray-300">{expiresTime.local}</div>
          </div>
        </div>

        {/* States */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">States:</span>
          <div className="flex flex-wrap gap-1">
            {alert.states.map(state => (
              <span
                key={state}
                className="px-2 py-0.5 bg-white/5 rounded text-xs font-medium text-gray-300 border border-white/10"
              >
                {state}
              </span>
            ))}
          </div>
        </div>

        {/* Headline */}
        {alert.headline && (
          <p className="text-sm text-gray-300 leading-relaxed mb-4 line-clamp-2">
            {alert.headline}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="
              px-4 py-2 rounded-lg text-sm font-medium
              bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white
              border border-white/10 hover:border-white/20
              transition-all duration-200
              flex items-center gap-2
            "
          >
            <span>{expanded ? 'Hide details' : 'View details'}</span>
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {alert.hasGeometry && onViewMap && (
            <button
              onClick={() => onViewMap(alert)}
              className="
                px-4 py-2 rounded-lg text-sm font-medium
                bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-300
                border border-cyan-500/30 hover:border-cyan-500/50
                transition-all duration-200
                flex items-center gap-2
              "
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span>View on map</span>
            </button>
          )}
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-5 pt-5 border-t border-white/10 space-y-4 animate-fadeIn">
            {/* Population breakdown */}
            {Object.keys(alert.population.byStateFormatted).length > 1 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Population by State</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(alert.population.byStateFormatted)
                    .sort(([, a], [, b]) => {
                      const aNum = parseFloat(a.replace(/[KM]/g, ''));
                      const bNum = parseFloat(b.replace(/[KM]/g, ''));
                      return bNum - aNum;
                    })
                    .map(([state, pop]) => (
                      <span
                        key={state}
                        className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400 border border-white/10"
                      >
                        {state}: <span className="text-white font-medium">{pop}</span>
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Top counties */}
            {alert.population.topCounties.length > 0 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Top Affected Counties</h4>
                <div className="space-y-1">
                  {alert.population.topCounties.slice(0, 3).map(county => (
                    <div key={county.fips} className="flex justify-between text-sm">
                      <span className="text-gray-400">{county.name}</span>
                      <span className="text-gray-300 font-medium">
                        {county.population.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Instructions */}
            {alert.instruction && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Instructions</h4>
                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                  {alert.instruction}
                </p>
              </div>
            )}

            {/* Full description */}
            {alert.description && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Full Description</h4>
                <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {alert.description}
                </p>
              </div>
            )}

            {/* Issuer */}
            <div className="text-xs text-gray-600">
              Issued by: {alert.sender}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
