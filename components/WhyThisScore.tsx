'use client';

import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { Info } from 'lucide-react';
import { RiskDriver, RiskBreakdownItem, DayExplainPayload } from '@/lib/types';

interface WhyThisScoreProps {
  explain?: DayExplainPayload | null;
  score: number;
  compact?: boolean;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Interactive "Why this score?" component
 * Shows a clickable info icon that reveals score explanation
 */
export function WhyThisScore({
  explain,
  score,
  compact = false,
  position = 'bottom',
}: WhyThisScoreProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  if (!explain) return null;

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'inline-flex items-center gap-1 text-mv-text-muted hover:text-mv-accent-blue transition-colors',
          compact ? 'text-xs' : 'text-sm'
        )}
        aria-label="Why this score?"
        aria-expanded={isOpen}
      >
        <Info className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        {!compact && <span className="underline-offset-2 hover:underline">Why?</span>}
      </button>

      {isOpen && (
        <div
          className={clsx(
            'absolute z-50 w-72 sm:w-80',
            'bg-mv-bg-primary border border-white/10 rounded-xl shadow-2xl',
            'p-4',
            positionClasses[position]
          )}
        >
          {/* Arrow */}
          <div
            className={clsx(
              'absolute w-3 h-3 bg-mv-bg-primary border-white/10 rotate-45',
              position === 'bottom' && 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 border-l border-t',
              position === 'top' && 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 border-r border-b',
              position === 'left' && 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 border-t border-r',
              position === 'right' && 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 border-b border-l'
            )}
          />

          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-mv-text-primary">
              Why {score.toFixed(1)}/10?
            </h4>
            <button
              onClick={() => setIsOpen(false)}
              className="text-mv-text-muted hover:text-mv-text-primary"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Summary */}
          <p className="text-xs text-mv-text-secondary leading-relaxed mb-3">
            {explain.summary_text}
          </p>

          {/* Top Drivers */}
          {explain.top_drivers && explain.top_drivers.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-mv-text-muted uppercase tracking-wider mb-2">
                Key Factors
              </div>
              <div className="space-y-1.5">
                {explain.top_drivers.slice(0, 4).map((driver, i) => (
                  <DriverRow key={i} driver={driver} />
                ))}
              </div>
            </div>
          )}

          {/* Breakdown bars */}
          {explain.breakdown && explain.breakdown.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-mv-text-muted uppercase tracking-wider mb-2">
                Score Breakdown
              </div>
              <div className="space-y-1.5">
                {explain.breakdown.slice(0, 5).map((item, i) => (
                  <BreakdownRow key={i} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DriverRow({ driver }: { driver: RiskDriver }) {
  const getColorClass = (score: number) => {
    if (score >= 2) return 'text-red-400 bg-red-500/10';
    if (score >= 1) return 'text-orange-400 bg-orange-500/10';
    return 'text-yellow-400 bg-yellow-500/10';
  };

  // Support both new (observation) and legacy (rawValue/unit) format
  const displayValue = driver.observation ||
    (driver.rawValue && driver.rawValue > 0 ? `${driver.rawValue}${driver.unit || ''}` : null);

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={clsx(
          'inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold',
          getColorClass(driver.score)
        )}>
          {driver.score.toFixed(1)}
        </span>
        <span className="text-xs text-mv-text-primary">{driver.hazard}</span>
      </div>
      {displayValue && (
        <span className="text-[10px] text-mv-text-muted font-mono truncate max-w-[100px]">
          {displayValue}
        </span>
      )}
    </div>
  );
}

function BreakdownRow({ item }: { item: RiskBreakdownItem }) {
  // Support both new (score) and legacy (contribution) format
  const scoreValue = item.score ?? item.contribution ?? 0;
  const percentage = Math.min(100, Math.max(0, (scoreValue / 4) * 100)); // Assuming max score is ~4

  // Support both new (hazard) and legacy (category as label) format
  const label = item.hazard || item.category;

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-mv-text-secondary truncate max-w-[55%]" title={item.observed}>
          {label}
        </span>
        <span className="text-mv-text-muted flex items-center gap-1">
          {item.observed && (
            <span className="font-mono text-[9px] opacity-70 truncate max-w-[60px]" title={item.observed}>
              {item.observed}
            </span>
          )}
          <span>+{scoreValue.toFixed(1)}</span>
        </span>
      </div>
      <div className="h-1 bg-mv-bg-tertiary rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-mv-accent-blue to-blue-400 rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Inline version - just shows key drivers as chips
 */
export function WhyThisScoreInline({ explain }: { explain?: DayExplainPayload | null }) {
  if (!explain?.top_drivers?.length) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {explain.top_drivers.slice(0, 3).map((driver, i) => {
        // Support both new (observation) and legacy (rawValue/unit) format
        const displayValue = driver.observation ||
          (driver.rawValue && driver.rawValue > 0 ? `${driver.rawValue}${driver.unit || ''}` : null);

        return (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-mv-bg-tertiary/60 text-[10px] text-mv-text-muted"
          >
            {driver.hazard}
            {displayValue && (
              <span className="font-mono opacity-70 truncate max-w-[50px]">
                {displayValue}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
