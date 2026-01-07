'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export interface TooltipData {
  x: number;
  y: number;
  payload: Record<string, unknown>;
  label: string;
}

export interface ChartInteractionsState {
  // Tooltip state
  activeTooltip: TooltipData | null;
  pinnedTooltip: TooltipData | null;
  isPinned: boolean;

  // Crosshair position
  crosshairX: number | null;
  crosshairY: number | null;

  // Zoom state
  zoomDomain: { start: number; end: number } | null;
  isZoomed: boolean;

  // Series visibility
  visibleSeries: Record<string, boolean>;

  // Hover state
  hoveredSeries: string | null;
}

export interface ChartInteractionsActions {
  // Tooltip actions
  setActiveTooltip: (tooltip: TooltipData | null) => void;
  pinTooltip: () => void;
  unpinTooltip: () => void;
  togglePin: () => void;

  // Crosshair actions
  setCrosshair: (x: number | null, y: number | null) => void;

  // Zoom actions
  setZoomDomain: (domain: { start: number; end: number } | null) => void;
  resetZoom: () => void;

  // Series actions
  toggleSeries: (seriesKey: string) => void;
  showAllSeries: () => void;
  hideAllSeries: () => void;
  setVisibleSeries: (series: Record<string, boolean>) => void;

  // Hover actions
  setHoveredSeries: (seriesKey: string | null) => void;
}

export interface UseChartInteractionsOptions {
  defaultVisibleSeries?: Record<string, boolean>;
  onSeriesToggle?: (seriesKey: string, visible: boolean) => void;
  onZoomChange?: (domain: { start: number; end: number } | null) => void;
}

export function useChartInteractions(
  options: UseChartInteractionsOptions = {}
): [ChartInteractionsState, ChartInteractionsActions] {
  const { defaultVisibleSeries = {}, onSeriesToggle, onZoomChange } = options;

  // Tooltip state
  const [activeTooltip, setActiveTooltipState] = useState<TooltipData | null>(null);
  const [pinnedTooltip, setPinnedTooltip] = useState<TooltipData | null>(null);
  const [isPinned, setIsPinned] = useState(false);

  // Crosshair state
  const [crosshairX, setCrosshairX] = useState<number | null>(null);
  const [crosshairY, setCrosshairY] = useState<number | null>(null);

  // Zoom state
  const [zoomDomain, setZoomDomainState] = useState<{ start: number; end: number } | null>(null);

  // Series visibility
  const [visibleSeries, setVisibleSeriesState] = useState<Record<string, boolean>>(defaultVisibleSeries);

  // Hover state
  const [hoveredSeries, setHoveredSeriesState] = useState<string | null>(null);

  // Escape key handler for unpinning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPinned) {
        setIsPinned(false);
        setPinnedTooltip(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPinned]);

  // Actions
  const setActiveTooltip = useCallback((tooltip: TooltipData | null) => {
    if (!isPinned) {
      setActiveTooltipState(tooltip);
    }
  }, [isPinned]);

  const pinTooltip = useCallback(() => {
    if (activeTooltip) {
      setPinnedTooltip(activeTooltip);
      setIsPinned(true);
    }
  }, [activeTooltip]);

  const unpinTooltip = useCallback(() => {
    setIsPinned(false);
    setPinnedTooltip(null);
  }, []);

  const togglePin = useCallback(() => {
    if (isPinned) {
      unpinTooltip();
    } else {
      pinTooltip();
    }
  }, [isPinned, pinTooltip, unpinTooltip]);

  const setCrosshair = useCallback((x: number | null, y: number | null) => {
    setCrosshairX(x);
    setCrosshairY(y);
  }, []);

  const setZoomDomain = useCallback((domain: { start: number; end: number } | null) => {
    setZoomDomainState(domain);
    onZoomChange?.(domain);
  }, [onZoomChange]);

  const resetZoom = useCallback(() => {
    setZoomDomainState(null);
    onZoomChange?.(null);
  }, [onZoomChange]);

  const toggleSeries = useCallback((seriesKey: string) => {
    setVisibleSeriesState(prev => {
      const newValue = !prev[seriesKey];
      onSeriesToggle?.(seriesKey, newValue);
      return { ...prev, [seriesKey]: newValue };
    });
  }, [onSeriesToggle]);

  const showAllSeries = useCallback(() => {
    setVisibleSeriesState(prev => {
      const newState: Record<string, boolean> = {};
      Object.keys(prev).forEach(key => {
        newState[key] = true;
      });
      return newState;
    });
  }, []);

  const hideAllSeries = useCallback(() => {
    setVisibleSeriesState(prev => {
      const newState: Record<string, boolean> = {};
      Object.keys(prev).forEach(key => {
        newState[key] = false;
      });
      return newState;
    });
  }, []);

  const setVisibleSeries = useCallback((series: Record<string, boolean>) => {
    setVisibleSeriesState(series);
  }, []);

  const setHoveredSeries = useCallback((seriesKey: string | null) => {
    setHoveredSeriesState(seriesKey);
  }, []);

  const state: ChartInteractionsState = {
    activeTooltip: isPinned ? pinnedTooltip : activeTooltip,
    pinnedTooltip,
    isPinned,
    crosshairX,
    crosshairY,
    zoomDomain,
    isZoomed: zoomDomain !== null,
    visibleSeries,
    hoveredSeries,
  };

  const actions: ChartInteractionsActions = {
    setActiveTooltip,
    pinTooltip,
    unpinTooltip,
    togglePin,
    setCrosshair,
    setZoomDomain,
    resetZoom,
    toggleSeries,
    showAllSeries,
    hideAllSeries,
    setVisibleSeries,
    setHoveredSeries,
  };

  return [state, actions];
}
