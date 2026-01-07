'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { RiskBadge } from './RiskBadge';
import { formatDayLabel } from '@/lib/formatDayLabel';
import { CloudRain, CloudSnow, Wind, AlertTriangle } from 'lucide-react';

interface DayNarrative {
  day: number;
  date: string;
  dayLabel: string;
  risk: number;
  narrative: string;
  hazards: string[];
}

interface SevenDayNarrativeResponse {
  days: DayNarrative[];
  generatedAt: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function getHazardIcon(hazard: string) {
  switch (hazard.toLowerCase()) {
    case 'snow':
      return <CloudSnow size={14} className="text-sky-400" />;
    case 'rain':
      return <CloudRain size={14} className="text-blue-400" />;
    case 'wind':
      return <Wind size={14} className="text-yellow-400" />;
    default:
      return <AlertTriangle size={14} className="text-orange-400" />;
  }
}

export function National7DayTable() {
  const { data, isLoading, error } = useSWR<SevenDayNarrativeResponse>(
    '/api/narrative-7day',
    fetcher,
    {
      refreshInterval: 3600000, // 1 hour
      revalidateOnFocus: false,
    }
  );

  if (isLoading) {
    return <National7DayTableSkeleton />;
  }

  if (error || !data?.days?.length) {
    return (
      <div className="bg-mv-bg-secondary rounded-xl border border-white/5 p-6">
        <h3 className="text-lg font-semibold text-mv-text-primary mb-4">
          7-Day National Forecast
        </h3>
        <p className="text-mv-text-muted text-sm">
          Unable to load forecast narratives. Please try again later.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-mv-bg-secondary rounded-xl border border-white/5 overflow-hidden">
      <div className="p-6 border-b border-white/5">
        <h3 className="text-lg font-semibold text-mv-text-primary">
          7-Day National Forecast
        </h3>
        <p className="text-sm text-mv-text-muted mt-1">
          Day-by-day weather outlook for the continental United States
        </p>
      </div>

      <div className="divide-y divide-white/5">
        {data.days.map((day) => (
          <DayRow key={day.day} day={day} />
        ))}
      </div>

      {data.generatedAt && (
        <div className="p-4 border-t border-white/5 bg-mv-bg-tertiary/30">
          <p className="text-xs text-mv-text-muted text-center">
            Last updated: {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

function DayRow({ day }: { day: DayNarrative }) {
  const formattedDate = useMemo(() => {
    const date = new Date(day.date + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }, [day.date]);

  return (
    <div className="p-4 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-start gap-4">
        {/* Day label and date */}
        <div className="w-24 flex-shrink-0">
          <div className="text-sm font-semibold text-mv-text-primary">
            {day.dayLabel}
          </div>
          <div className="text-xs text-mv-text-muted">{formattedDate}</div>
        </div>

        {/* Risk badge */}
        <div className="flex-shrink-0">
          <RiskBadge score={day.risk} size="sm" />
        </div>

        {/* Narrative and hazards */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-mv-text-secondary leading-relaxed">
            {day.narrative}
          </p>

          {day.hazards.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              {day.hazards.map((hazard) => (
                <span
                  key={hazard}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 text-xs text-mv-text-muted"
                >
                  {getHazardIcon(hazard)}
                  {hazard}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function National7DayTableSkeleton() {
  return (
    <div className="bg-mv-bg-secondary rounded-xl border border-white/5 overflow-hidden animate-pulse">
      <div className="p-6 border-b border-white/5">
        <div className="h-6 w-48 bg-mv-bg-tertiary rounded" />
        <div className="h-4 w-72 bg-mv-bg-tertiary rounded mt-2" />
      </div>

      <div className="divide-y divide-white/5">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="p-4">
            <div className="flex items-start gap-4">
              <div className="w-24 flex-shrink-0">
                <div className="h-4 w-16 bg-mv-bg-tertiary rounded" />
                <div className="h-3 w-12 bg-mv-bg-tertiary rounded mt-1" />
              </div>
              <div className="w-10 h-10 bg-mv-bg-tertiary rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-mv-bg-tertiary rounded w-full" />
                <div className="h-4 bg-mv-bg-tertiary rounded w-5/6" />
                <div className="h-4 bg-mv-bg-tertiary rounded w-3/4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function National7DayTableCompact() {
  const { data, isLoading } = useSWR<SevenDayNarrativeResponse>(
    '/api/narrative-7day',
    fetcher,
    {
      refreshInterval: 3600000,
      revalidateOnFocus: false,
    }
  );

  if (isLoading || !data?.days?.length) {
    return (
      <div className="grid grid-cols-7 gap-2 animate-pulse">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="bg-mv-bg-tertiary rounded-lg p-2 h-20" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-7 gap-2">
      {data.days.map((day) => (
        <div
          key={day.day}
          className="bg-mv-bg-tertiary/50 rounded-lg p-2 text-center"
        >
          <div className="text-xs font-medium text-mv-text-muted mb-1">
            {day.dayLabel.slice(0, 3)}
          </div>
          <RiskBadge score={day.risk} size="sm" />
          {day.hazards.length > 0 && (
            <div className="flex justify-center gap-1 mt-1">
              {day.hazards.slice(0, 2).map((h) => (
                <span key={h}>{getHazardIcon(h)}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
