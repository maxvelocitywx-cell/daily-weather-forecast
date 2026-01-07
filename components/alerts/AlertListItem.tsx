'use client';

import { forwardRef, memo } from 'react';
import { Clock } from 'lucide-react';

// Severity dot colors
const severityDotColors: Record<string, string> = {
  Extreme: 'bg-red-500',
  Severe: 'bg-orange-500',
  Moderate: 'bg-yellow-500',
  Minor: 'bg-cyan-500',
  Unknown: 'bg-gray-500'
};

export interface AlertListItemData {
  id: string;
  event: string;
  severity: string;
  expires: string;
  areaDesc: string;
  states: string[];
  hasGeometry: boolean;
}

interface AlertListItemProps {
  alert: AlertListItemData;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
  style?: React.CSSProperties;
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
    return { text: `${days}d`, urgent: false };
  }
  if (hours >= 1) {
    return { text: `${hours}h`, urgent: hours < 3 };
  }
  return { text: `${minutes}m`, urgent: true };
}

const AlertListItem = memo(forwardRef<HTMLDivElement, AlertListItemProps>(({
  alert,
  isSelected,
  isHovered,
  onSelect,
  onHover,
  style
}, ref) => {
  const dotColor = severityDotColors[alert.severity] || severityDotColors.Unknown;
  const timeRemaining = getTimeRemaining(alert.expires);

  return (
    <div
      ref={ref}
      style={style}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`
        px-3 py-2.5 cursor-pointer transition-all duration-150
        border-b border-white/5 last:border-b-0
        ${isSelected
          ? 'bg-white/10 border-l-2 border-l-cyan-500'
          : isHovered
            ? 'bg-white/5'
            : 'hover:bg-white/5'
        }
      `}
    >
      <div className="flex items-start gap-2.5">
        {/* Severity dot */}
        <div className={`w-2.5 h-2.5 rounded-full ${dotColor} flex-shrink-0 mt-1`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Event name */}
          <div className="text-sm font-medium text-white truncate">
            {alert.event}
          </div>

          {/* Area/states */}
          <div className="text-xs text-gray-500 truncate mt-0.5">
            {alert.states.length > 0
              ? alert.states.slice(0, 2).join(', ') + (alert.states.length > 2 ? ` +${alert.states.length - 2}` : '')
              : alert.areaDesc.split(',')[0]
            }
          </div>
        </div>

        {/* Time remaining */}
        <div className={`
          flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0
          ${timeRemaining.urgent
            ? 'bg-red-500/15 text-red-400'
            : 'bg-white/5 text-gray-500'
          }
        `}>
          <Clock size={10} />
          {timeRemaining.text}
        </div>
      </div>
    </div>
  );
}));

AlertListItem.displayName = 'AlertListItem';

export default AlertListItem;
