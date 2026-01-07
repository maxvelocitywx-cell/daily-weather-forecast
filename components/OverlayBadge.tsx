'use client';

import { SPCDayOutlook, EROLevel } from '@/lib/types';
import clsx from 'clsx';

interface OverlayBadgesProps {
  spc?: SPCDayOutlook;
  ero?: EROLevel;
  size?: 'sm' | 'md';
}

const SPC_COLORS: Record<string, string> = {
  'TSTM': 'bg-green-600/20 text-green-400 border-green-500/30',
  'MRGL': 'bg-green-500/20 text-green-400 border-green-500/30',
  'SLGT': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'ENH': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'MDT': 'bg-red-500/20 text-red-400 border-red-500/30',
  'HIGH': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const ERO_COLORS: Record<string, string> = {
  'MRGL': 'bg-green-500/20 text-green-400 border-green-500/30',
  'SLGT': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'MDT': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'HIGH': 'bg-red-500/20 text-red-400 border-red-500/30',
};

export function OverlayBadges({ spc, ero, size = 'sm' }: OverlayBadgesProps) {
  const hasSPC = spc?.categorical && spc.categorical.level > 0;
  const hasERO = ero && ero.level > 0;

  if (!hasSPC && !hasERO) return null;

  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

  return (
    <div className="flex items-center gap-2">
      {hasSPC && spc?.categorical && (
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md border font-medium',
            sizeClass,
            SPC_COLORS[spc.categorical.category] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
          )}
        >
          <span className="text-[10px] opacity-70">SPC</span>
          <span>{spc.categorical.category}</span>
        </span>
      )}

      {hasERO && (
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md border font-medium',
            sizeClass,
            ERO_COLORS[ero.category] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
          )}
        >
          <span className="text-[10px] opacity-70">ERO</span>
          <span>{ero.category}</span>
        </span>
      )}
    </div>
  );
}

export function OverlayToggle({
  enabled,
  onToggle,
  available,
}: {
  enabled: boolean;
  onToggle: () => void;
  available: boolean;
}) {
  if (!available) return null;

  return (
    <button
      onClick={onToggle}
      className={clsx(
        'text-xs px-3 py-1.5 rounded-lg transition-colors font-medium',
        enabled
          ? 'bg-mv-accent-blue/20 text-mv-accent-blue border border-mv-accent-blue/30'
          : 'bg-mv-bg-tertiary text-mv-text-muted border border-white/5 hover:border-white/10'
      )}
    >
      {enabled ? 'Overlays On' : 'Overlays Off'}
    </button>
  );
}

export function OverlayStatus({
  spcAvailable,
  eroAvailable,
}: {
  spcAvailable: boolean;
  eroAvailable: boolean;
}) {
  if (!spcAvailable && !eroAvailable) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-mv-text-muted">
      {spcAvailable && (
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          SPC
        </span>
      )}
      {eroAvailable && (
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          ERO
        </span>
      )}
    </div>
  );
}
