'use client';

import clsx from 'clsx';
import { formatDayLabel } from '@/lib/formatDayLabel';

interface RegionDaySelectorProps {
  selectedDay: number;
  onDayChange: (day: number) => void;
  maxDays?: number;
}

export function RegionDaySelector({
  selectedDay,
  onDayChange,
  maxDays = 3,
}: RegionDaySelectorProps) {
  const days = Array.from({ length: maxDays }, (_, i) => i + 1);

  return (
    <div className="flex items-center gap-1 bg-mv-bg-tertiary/50 rounded-lg p-1">
      {days.map((day) => {
        const isSelected = selectedDay === day;
        const label = formatDayLabel(day);

        return (
          <button
            key={day}
            onClick={() => onDayChange(day)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
              isSelected
                ? 'bg-mv-accent-blue text-white shadow-md'
                : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function CompactDaySelector({
  selectedDay,
  onDayChange,
  maxDays = 7,
}: RegionDaySelectorProps) {
  const days = Array.from({ length: maxDays }, (_, i) => i + 1);

  return (
    <div className="flex items-center gap-0.5">
      {days.map((day) => {
        const isSelected = selectedDay === day;

        return (
          <button
            key={day}
            onClick={() => onDayChange(day)}
            className={clsx(
              'w-8 h-8 rounded-md text-xs font-medium transition-all duration-200 flex items-center justify-center',
              isSelected
                ? 'bg-mv-accent-blue text-white'
                : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
            )}
          >
            {day}
          </button>
        );
      })}
    </div>
  );
}
