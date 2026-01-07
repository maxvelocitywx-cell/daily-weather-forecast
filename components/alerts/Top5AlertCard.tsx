'use client';

import { useState, forwardRef } from 'react';
import { ChevronDown, MapPin, Clock, Users, Building2 } from 'lucide-react';

// Severity colors (neon accents)
const severityColors: Record<string, { bg: string; border: string; glow: string; text: string; gradient: string }> = {
  Extreme: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/40',
    glow: 'shadow-[0_0_20px_rgba(239,68,68,0.3)]',
    text: 'text-red-400',
    gradient: 'from-red-600 to-rose-600'
  },
  Severe: {
    bg: 'bg-orange-500/15',
    border: 'border-orange-500/40',
    glow: 'shadow-[0_0_20px_rgba(249,115,22,0.3)]',
    text: 'text-orange-400',
    gradient: 'from-orange-500 to-amber-500'
  },
  Moderate: {
    bg: 'bg-yellow-500/15',
    border: 'border-yellow-500/40',
    glow: 'shadow-[0_0_20px_rgba(234,179,8,0.3)]',
    text: 'text-yellow-400',
    gradient: 'from-yellow-500 to-amber-400'
  },
  Minor: {
    bg: 'bg-cyan-500/15',
    border: 'border-cyan-500/40',
    glow: 'shadow-[0_0_20px_rgba(34,211,238,0.3)]',
    text: 'text-cyan-400',
    gradient: 'from-cyan-500 to-blue-500'
  },
  Unknown: {
    bg: 'bg-gray-500/15',
    border: 'border-gray-500/40',
    glow: 'shadow-[0_0_15px_rgba(156,163,175,0.2)]',
    text: 'text-gray-400',
    gradient: 'from-gray-500 to-gray-600'
  }
};

// Event type gradient overrides
const eventGradients: Record<string, string> = {
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

// Rank badge colors
const rankColors: Record<number, string> = {
  1: 'from-yellow-400 via-amber-500 to-orange-500',
  2: 'from-gray-300 via-gray-400 to-gray-500',
  3: 'from-amber-600 via-orange-700 to-amber-800',
  4: 'from-cyan-500 via-blue-500 to-indigo-500',
  5: 'from-purple-500 via-violet-500 to-indigo-500'
};

export interface AlertData {
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
  geometry?: {
    type: string;
    coordinates: number[][][] | number[][][][];
  } | null;
  sender: string;
}

interface Top5AlertCardProps {
  alert: AlertData;
  rank: number;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onViewMap: () => void;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

function getTimeRemaining(expires: string): { text: string; urgent: boolean } {
  const now = Date.now();
  const expTime = new Date(expires).getTime();
  const diff = expTime - now;

  if (diff <= 0) return { text: 'Expired', urgent: false };

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return { text: `${days}d ${hours % 24}h`, urgent: false };
  }
  if (hours >= 1) {
    return { text: `${hours}h ${minutes}m`, urgent: hours < 3 };
  }
  return { text: `${minutes}m`, urgent: true };
}

const Top5AlertCard = forwardRef<HTMLDivElement, Top5AlertCardProps>(({
  alert,
  rank,
  isSelected,
  isHovered,
  onSelect,
  onViewMap
}, ref) => {
  const [expanded, setExpanded] = useState(false);
  const colors = severityColors[alert.severity] || severityColors.Unknown;
  const gradientClass = eventGradients[alert.event] || colors.gradient;
  const timeRemaining = getTimeRemaining(alert.expires);

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={`
        relative overflow-hidden rounded-2xl cursor-pointer
        bg-gradient-to-br from-gray-900/90 via-gray-900/70 to-gray-800/50
        backdrop-blur-xl border transition-all duration-300 ease-out
        ${isSelected ? `${colors.border} ${colors.glow} scale-[1.01]` : 'border-white/10'}
        ${isHovered && !isSelected ? 'border-white/20 scale-[1.005]' : ''}
        hover:border-white/20
      `}
    >
      {/* Gradient accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${gradientClass}`} />

      {/* Rank badge */}
      <div className={`
        absolute top-3 left-3 w-10 h-10 rounded-xl
        bg-gradient-to-br ${rankColors[rank] || 'from-gray-500 to-gray-600'}
        flex items-center justify-center
        shadow-lg
      `}>
        <span className="text-white font-black text-lg">#{rank}</span>
      </div>

      {/* Main content */}
      <div className="p-5 pl-16">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className={`text-lg font-bold ${colors.text} tracking-wide`}>
              {alert.event}
            </h3>
            <p className="text-sm text-gray-400 mt-1 line-clamp-1 flex items-center gap-1">
              <MapPin size={12} className="flex-shrink-0" />
              {alert.areaDesc}
            </p>
          </div>

          {/* Population badge */}
          <div className="flex-shrink-0 text-right">
            <div className="flex items-center gap-1 text-xl font-bold text-white">
              <Users size={16} className="text-gray-500" />
              {alert.populationFormatted}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">affected</div>
          </div>
        </div>

        {/* Info row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {/* Severity chip */}
          <span className={`
            px-2.5 py-1 rounded-full text-xs font-semibold
            ${colors.bg} ${colors.text} border ${colors.border}
          `}>
            {alert.severity}
          </span>

          {/* Urgency chip */}
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
            {alert.urgency}
          </span>

          {/* Time remaining */}
          <span className={`
            px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1
            ${timeRemaining.urgent
              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
              : 'bg-white/5 text-gray-400 border border-white/10'
            }
          `}>
            <Clock size={12} />
            {timeRemaining.text}
          </span>

          {/* States */}
          {alert.states.length > 0 && (
            <div className="flex items-center gap-1">
              {alert.states.slice(0, 3).map(state => (
                <span
                  key={state}
                  className="px-2 py-0.5 bg-white/5 rounded text-xs font-medium text-gray-300 border border-white/10"
                >
                  {state}
                </span>
              ))}
              {alert.states.length > 3 && (
                <span className="text-xs text-gray-500">+{alert.states.length - 3}</span>
              )}
            </div>
          )}
        </div>

        {/* Headline preview */}
        {alert.headline && (
          <p className="text-sm text-gray-300 leading-relaxed line-clamp-2 mb-3">
            {alert.headline}
          </p>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white
              border border-white/10 hover:border-white/20
              transition-all duration-200
            "
          >
            <span>{expanded ? 'Hide' : 'Details'}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>

          {alert.hasGeometry && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewMap();
              }}
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-300
                border border-cyan-500/30 hover:border-cyan-500/50
                transition-all duration-200
              "
            >
              <MapPin size={12} />
              <span>View on Map</span>
            </button>
          )}

          {/* Source */}
          <div className="ml-auto flex items-center gap-1 text-xs text-gray-600">
            <Building2 size={11} />
            <span className="truncate max-w-[120px]">{alert.sender}</span>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-white/10 space-y-4 animate-fadeIn">
            {/* Time details */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Effective</div>
                <div className="text-gray-300">{formatDateTime(alert.effective)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Expires</div>
                <div className="text-gray-300">{formatDateTime(alert.expires)}</div>
              </div>
            </div>

            {/* Population breakdown */}
            {Object.keys(alert.population.byStateFormatted).length > 1 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Population by State</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(alert.population.byStateFormatted)
                    .sort(([, a], [, b]) => {
                      const aNum = parseFloat(a.replace(/[KM]/g, '')) * (a.includes('M') ? 1000 : 1);
                      const bNum = parseFloat(b.replace(/[KM]/g, '')) * (b.includes('M') ? 1000 : 1);
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
                      <span className="text-gray-300 font-medium tabular-nums">
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
                <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">
                  {alert.description}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

Top5AlertCard.displayName = 'Top5AlertCard';

export default Top5AlertCard;
