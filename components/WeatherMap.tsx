'use client';

import dynamic from 'next/dynamic';
import { RegionId, RegionRiskData, CityMetricsSummary } from '@/lib/types';

// Dynamically import the map component with SSR disabled to avoid CSP issues
const WeatherMapClient = dynamic(() => import('./WeatherMapClient'), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

interface WeatherMapProps {
  regionRisks: Partial<Record<RegionId, RegionRiskData>>;
  cities: CityMetricsSummary[];
  selectedRegion: RegionId | null;
  selectedDay: number;
  onRegionSelect: (region: RegionId | null) => void;
  onDayChange?: (day: number) => void;
}

export function WeatherMap(props: WeatherMapProps) {
  return <WeatherMapClient {...props} />;
}

export function MapPlaceholder() {
  return (
    <div className="w-full h-full min-h-[400px] rounded-xl bg-mv-bg-secondary border border-white/5 flex items-center justify-center">
      <div className="text-center">
        <div className="text-mv-text-muted mb-2">Loading map...</div>
        <div className="text-xs text-mv-text-muted/60">
          Initializing Mapbox
        </div>
      </div>
    </div>
  );
}
