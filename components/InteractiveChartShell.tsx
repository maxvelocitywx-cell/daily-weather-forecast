'use client';

import { useRef, useState, useCallback, ReactNode } from 'react';
import clsx from 'clsx';
import { Download, Link, RotateCcw, Eye, EyeOff, Pin, PinOff } from 'lucide-react';
import { exportChartToPNG, generateChartShareUrl, copyChartUrlToClipboard } from '@/lib/chartExport';

interface SeriesConfig {
  key: string;
  name: string;
  color: string;
}

interface InteractiveChartShellProps {
  children: ReactNode;
  title?: string;
  className?: string;

  // Series management
  series?: SeriesConfig[];
  visibleSeries?: Record<string, boolean>;
  onToggleSeries?: (key: string) => void;
  onShowAll?: () => void;
  onHideAll?: () => void;
  hoveredSeries?: string | null;
  onHoverSeries?: (key: string | null) => void;

  // Zoom controls
  isZoomed?: boolean;
  onResetZoom?: () => void;

  // Tooltip pinning
  isPinned?: boolean;
  onTogglePin?: () => void;

  // Export
  exportFilename?: string;
  shareState?: {
    cityId?: string;
    regionId?: string;
    day?: number;
    tab?: string;
    compareCityId?: string;
  };

  // Toolbar visibility
  showToolbar?: boolean;
  showLegend?: boolean;
  showExport?: boolean;
  showShare?: boolean;
  compact?: boolean;
}

export function InteractiveChartShell({
  children,
  title,
  className,
  series = [],
  visibleSeries = {},
  onToggleSeries,
  onShowAll,
  onHideAll,
  hoveredSeries,
  onHoverSeries,
  isZoomed = false,
  onResetZoom,
  isPinned = false,
  onTogglePin,
  exportFilename = 'chart',
  shareState,
  showToolbar = true,
  showLegend = true,
  showExport = true,
  showShare = true,
  compact = false,
}: InteractiveChartShellProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await exportChartToPNG(chartRef.current, exportFilename);
    } finally {
      setIsExporting(false);
    }
  }, [exportFilename, isExporting]);

  const handleShare = useCallback(async () => {
    if (!shareState) return;
    const url = generateChartShareUrl(window.location.href.split('?')[0], shareState);
    const success = await copyChartUrlToClipboard(url);
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  }, [shareState]);

  const allVisible = series.length > 0 && series.every(s => visibleSeries[s.key] !== false);
  const noneVisible = series.length > 0 && series.every(s => visibleSeries[s.key] === false);

  return (
    <div className={clsx('relative', className)}>
      {/* Toolbar */}
      {showToolbar && (
        <div className={clsx(
          'flex items-center justify-between gap-2 mb-2',
          compact ? 'flex-wrap' : ''
        )}>
          {title && (
            <h4 className="text-sm font-medium text-mv-text-muted">{title}</h4>
          )}

          <div className="flex items-center gap-1 ml-auto">
            {/* Reset zoom button */}
            {isZoomed && onResetZoom && (
              <button
                onClick={onResetZoom}
                className="flex items-center gap-1 px-2 py-1 text-xs text-mv-accent bg-mv-accent/10 rounded hover:bg-mv-accent/20 transition-colors"
                title="Reset zoom"
              >
                <RotateCcw className="w-3 h-3" />
                {!compact && 'Reset'}
              </button>
            )}

            {/* Pin tooltip button */}
            {onTogglePin && (
              <button
                onClick={onTogglePin}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  isPinned
                    ? 'text-mv-accent bg-mv-accent/20'
                    : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
                )}
                title={isPinned ? 'Unpin tooltip (Esc)' : 'Pin tooltip (click chart)'}
              >
                {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              </button>
            )}

            {/* Series visibility controls */}
            {series.length > 0 && (onShowAll || onHideAll) && (
              <div className="flex items-center border-l border-white/10 ml-1 pl-1">
                {onShowAll && (
                  <button
                    onClick={onShowAll}
                    disabled={allVisible}
                    className={clsx(
                      'p-1.5 rounded transition-colors',
                      allVisible
                        ? 'text-mv-text-muted/50 cursor-not-allowed'
                        : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
                    )}
                    title="Show all series"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
                {onHideAll && (
                  <button
                    onClick={onHideAll}
                    disabled={noneVisible}
                    className={clsx(
                      'p-1.5 rounded transition-colors',
                      noneVisible
                        ? 'text-mv-text-muted/50 cursor-not-allowed'
                        : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
                    )}
                    title="Hide all series"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Export button */}
            {showExport && (
              <button
                onClick={handleExport}
                disabled={isExporting}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  isExporting
                    ? 'text-mv-text-muted/50 cursor-wait'
                    : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
                )}
                title="Download PNG"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Share button */}
            {showShare && shareState && (
              <button
                onClick={handleShare}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  copySuccess
                    ? 'text-green-400 bg-green-400/10'
                    : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
                )}
                title={copySuccess ? 'Copied!' : 'Copy link'}
              >
                <Link className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      {showLegend && series.length > 0 && onToggleSeries && (
        <div className={clsx(
          'flex flex-wrap gap-2 mb-3',
          compact ? 'gap-1' : ''
        )}>
          {series.map(s => {
            const isVisible = visibleSeries[s.key] !== false;
            const isHovered = hoveredSeries === s.key;
            const isDimmed = hoveredSeries !== null && !isHovered;

            return (
              <button
                key={s.key}
                onClick={() => onToggleSeries(s.key)}
                onMouseEnter={() => onHoverSeries?.(s.key)}
                onMouseLeave={() => onHoverSeries?.(null)}
                className={clsx(
                  'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all',
                  isVisible
                    ? 'bg-white/5 hover:bg-white/10'
                    : 'bg-transparent opacity-50 hover:opacity-75',
                  isDimmed && 'opacity-40',
                  isHovered && 'ring-1 ring-white/20'
                )}
              >
                <span
                  className={clsx(
                    'w-2.5 h-2.5 rounded-full transition-opacity',
                    !isVisible && 'opacity-30'
                  )}
                  style={{ backgroundColor: s.color }}
                />
                <span className={clsx(
                  'text-mv-text-primary',
                  !isVisible && 'line-through text-mv-text-muted'
                )}>
                  {s.name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Chart container */}
      <div ref={chartRef} className="relative">
        {children}
      </div>
    </div>
  );
}

/**
 * Interactive tooltip component for SVG charts
 */
interface ChartTooltipProps {
  x: number;
  y: number;
  visible: boolean;
  isPinned?: boolean;
  onPin?: () => void;
  children: ReactNode;
  containerWidth?: number;
  containerHeight?: number;
}

export function ChartTooltip({
  x,
  y,
  visible,
  isPinned = false,
  onPin,
  children,
  containerWidth = 400,
  containerHeight = 200,
}: ChartTooltipProps) {
  if (!visible) return null;

  // Calculate position to avoid clipping
  const tooltipWidth = 180;
  const tooltipHeight = 100;
  const padding = 10;

  let posX = x + 15;
  let posY = y - 10;

  // Flip to left if would clip right edge
  if (posX + tooltipWidth > containerWidth - padding) {
    posX = x - tooltipWidth - 15;
  }

  // Flip to below if would clip top
  if (posY < padding) {
    posY = y + 20;
  }

  // Move up if would clip bottom
  if (posY + tooltipHeight > containerHeight - padding) {
    posY = containerHeight - tooltipHeight - padding;
  }

  return (
    <div
      className={clsx(
        'absolute pointer-events-none z-50 transition-opacity duration-150',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      style={{
        left: posX,
        top: posY,
        transform: 'translateZ(0)', // Force GPU layer
      }}
    >
      <div
        className={clsx(
          'bg-mv-bg-primary/95 backdrop-blur-sm border rounded-lg p-2 shadow-xl min-w-[120px]',
          isPinned ? 'border-mv-accent/50' : 'border-white/20'
        )}
        onClick={(e) => {
          e.stopPropagation();
          onPin?.();
        }}
        style={{ pointerEvents: isPinned ? 'auto' : 'none' }}
      >
        {isPinned && (
          <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-mv-accent rounded-full flex items-center justify-center">
            <Pin className="w-2 h-2 text-white" />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Crosshair overlay for SVG charts
 */
interface ChartCrosshairProps {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  showVertical?: boolean;
  showHorizontal?: boolean;
  color?: string;
}

export function ChartCrosshair({
  x,
  y,
  width,
  height,
  showVertical = true,
  showHorizontal = false,
  color = 'rgba(255, 255, 255, 0.3)',
}: ChartCrosshairProps) {
  if (x === null && y === null) return null;

  return (
    <g className="pointer-events-none">
      {showVertical && x !== null && (
        <line
          x1={x}
          y1={0}
          x2={x}
          y2={height}
          stroke={color}
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      )}
      {showHorizontal && y !== null && (
        <line
          x1={0}
          y1={y}
          x2={width}
          y2={y}
          stroke={color}
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      )}
    </g>
  );
}
