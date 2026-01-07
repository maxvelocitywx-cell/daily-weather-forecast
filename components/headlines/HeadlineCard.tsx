'use client';

import { ExternalLink, Clock, MapPin } from 'lucide-react';
import { Headline, HeadlineTopic, HeadlineConfidence } from '@/lib/headlines/types';

// Topic colors and icons
const topicConfig: Record<HeadlineTopic, { bg: string; border: string; glow: string; text: string; icon: string }> = {
  severe: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/40',
    glow: 'shadow-[0_0_20px_rgba(239,68,68,0.2)]',
    text: 'text-red-400',
    icon: '⚡',
  },
  winter: {
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/40',
    glow: 'shadow-[0_0_20px_rgba(34,211,238,0.2)]',
    text: 'text-cyan-400',
    icon: '❄️',
  },
  flood: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/40',
    glow: 'shadow-[0_0_20px_rgba(59,130,246,0.2)]',
    text: 'text-blue-400',
    icon: '🌊',
  },
  tropical: {
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/40',
    glow: 'shadow-[0_0_20px_rgba(168,85,247,0.2)]',
    text: 'text-purple-400',
    icon: '🌀',
  },
  heat: {
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/40',
    glow: 'shadow-[0_0_20px_rgba(249,115,22,0.2)]',
    text: 'text-orange-400',
    icon: '🔥',
  },
  fire: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    glow: 'shadow-[0_0_20px_rgba(245,158,11,0.2)]',
    text: 'text-amber-400',
    icon: '🔥',
  },
  aviation: {
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/40',
    glow: 'shadow-[0_0_20px_rgba(100,116,139,0.2)]',
    text: 'text-slate-400',
    icon: '✈️',
  },
  marine: {
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/40',
    glow: 'shadow-[0_0_20px_rgba(20,184,166,0.2)]',
    text: 'text-teal-400',
    icon: '⚓',
  },
  general: {
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/40',
    glow: 'shadow-[0_0_15px_rgba(156,163,175,0.15)]',
    text: 'text-gray-400',
    icon: '📍',
  },
};

// Confidence badge styles - distinguishing measured/reported/surveyed from outlook-based
const confidenceConfig: Record<HeadlineConfidence, { bg: string; text: string; border: string; label: string }> = {
  measured: {
    bg: 'bg-emerald-500/20',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    label: 'Measured',
  },
  reported: {
    bg: 'bg-amber-500/20',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    label: 'Reported',
  },
  surveyed: {
    bg: 'bg-violet-500/20',
    text: 'text-violet-400',
    border: 'border-violet-500/30',
    label: 'Surveyed',
  },
  high: {
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/30',
    label: 'High',
  },
  medium: {
    bg: 'bg-yellow-500/20',
    text: 'text-yellow-400',
    border: 'border-yellow-500/30',
    label: 'Medium',
  },
  low: {
    bg: 'bg-gray-500/20',
    text: 'text-gray-400',
    border: 'border-gray-500/30',
    label: 'Low',
  },
};

interface HeadlineCardProps {
  headline: Headline;
  rank: number;
}

/**
 * Format timestamp to relative time
 */
function formatTimeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Check if this is a real-time observation headline (has lat/lon)
 */
function isRealTimeHeadline(headline: Headline): boolean {
  return headline.lat !== undefined && headline.lon !== undefined;
}

export default function HeadlineCard({ headline, rank }: HeadlineCardProps) {
  const config = topicConfig[headline.topic] || topicConfig.general;
  const confConfig = confidenceConfig[headline.confidence] || confidenceConfig.low;
  const isRealTime = isRealTimeHeadline(headline);

  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl
        bg-gradient-to-br from-gray-900/90 via-gray-900/70 to-gray-800/50
        backdrop-blur-xl border transition-all duration-300 ease-out
        hover:scale-[1.01] hover:border-white/20
        ${config.border} ${config.glow}
      `}
    >
      {/* Gradient accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${config.bg}`} />

      {/* Rank badge */}
      <div className="absolute top-4 left-4 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
        <span className="text-white/70 font-bold text-sm">#{rank}</span>
      </div>

      {/* Content */}
      <div className="p-5 pl-14">
        {/* Topic icon and headline */}
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl" role="img" aria-label={headline.topic}>
            {config.icon}
          </span>
          <h3 className="text-lg font-bold text-white leading-tight flex-1">
            {headline.headline}
          </h3>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {/* Topic chip */}
          <span
            className={`
              px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide
              ${config.bg} ${config.text} border ${config.border}
            `}
          >
            {headline.topic}
          </span>

          {/* Confidence badge - prominent for real-time data */}
          <span
            className={`
              px-2.5 py-1 rounded-full text-xs font-medium border
              ${confConfig.bg} ${confConfig.text} ${confConfig.border}
              ${isRealTime ? 'ring-1 ring-offset-1 ring-offset-gray-900' : ''}
            `}
          >
            {confConfig.label}
          </span>

          {/* Timestamp (for real-time events) */}
          {headline.timestamp && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded text-xs text-gray-400 border border-white/10">
              <Clock size={10} />
              {formatTimeAgo(headline.timestamp)}
            </span>
          )}

          {/* Location dot indicator (for real-time events with coordinates) */}
          {isRealTime && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 bg-cyan-500/10 rounded text-xs text-cyan-400 border border-cyan-500/20"
              title={`${headline.lat?.toFixed(2)}, ${headline.lon?.toFixed(2)}`}
            >
              <MapPin size={10} />
              <span className="hidden sm:inline">Location</span>
            </span>
          )}

          {/* Regions */}
          {headline.regions.slice(0, 2).map((region) => (
            <span
              key={region}
              className="px-2 py-0.5 bg-white/5 rounded text-xs font-medium text-gray-300 border border-white/10"
            >
              {region}
            </span>
          ))}
          {headline.regions.length > 2 && (
            <span className="text-xs text-gray-500">+{headline.regions.length - 2}</span>
          )}
        </div>

        {/* Source link */}
        <a
          href={headline.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="
            inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-cyan-400
            transition-colors duration-200
          "
        >
          <ExternalLink size={12} />
          <span>{headline.source_name}</span>
        </a>
      </div>

      {/* Real-time indicator dot in corner */}
      {isRealTime && (
        <div className="absolute top-3 right-3">
          <div className="relative">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-75"></div>
          </div>
        </div>
      )}
    </div>
  );
}
