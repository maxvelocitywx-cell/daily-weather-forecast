'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import useSWR from 'swr';
import { SPCOutlook, EROOutlook, LocationOverlay } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface OverlayContextValue {
  spcData: SPCOutlook | null;
  eroData: EROOutlook | null;
  spcAvailable: boolean;
  eroAvailable: boolean;
  overlaysEnabled: boolean;
  toggleOverlays: () => void;
  isLoading: boolean;
}

const OverlayContext = createContext<OverlayContextValue>({
  spcData: null,
  eroData: null,
  spcAvailable: false,
  eroAvailable: false,
  overlaysEnabled: true,
  toggleOverlays: () => {},
  isLoading: false,
});

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [overlaysEnabled, setOverlaysEnabled] = useState(true);

  const { data: spcData, isLoading: spcLoading } = useSWR<SPCOutlook>(
    '/api/overlay/spc',
    fetcher,
    {
      refreshInterval: 900000, // 15 minutes
      revalidateOnFocus: false,
    }
  );

  const { data: eroData, isLoading: eroLoading } = useSWR<EROOutlook>(
    '/api/overlay/wpc-ero',
    fetcher,
    {
      refreshInterval: 900000,
      revalidateOnFocus: false,
    }
  );

  // Check if overlays have meaningful data
  const spcAvailable = !!(
    spcData?.day1?.categorical?.level ||
    spcData?.day2?.categorical?.level ||
    spcData?.day3?.categorical?.level
  );

  const eroAvailable = !!(
    eroData?.day1?.level ||
    eroData?.day2?.level ||
    eroData?.day3?.level
  );

  const toggleOverlays = () => {
    setOverlaysEnabled((prev) => !prev);
  };

  return (
    <OverlayContext.Provider
      value={{
        spcData: spcData || null,
        eroData: eroData || null,
        spcAvailable,
        eroAvailable,
        overlaysEnabled,
        toggleOverlays,
        isLoading: spcLoading || eroLoading,
      }}
    >
      {children}
    </OverlayContext.Provider>
  );
}

export function useOverlays() {
  return useContext(OverlayContext);
}

/**
 * Get overlay data for a specific location (mock implementation)
 * In production, this would do point-in-polygon checks against SPC/WPC polygons
 */
export function useLocationOverlay(lat: number, lon: number): LocationOverlay | null {
  const { spcData, eroData, overlaysEnabled } = useOverlays();

  if (!overlaysEnabled || (!spcData && !eroData)) {
    return null;
  }

  // Mock: return the general outlook data
  // In production, you'd check if the lat/lon falls within specific risk polygons
  return {
    spc: spcData || undefined,
    ero: eroData || undefined,
  };
}
