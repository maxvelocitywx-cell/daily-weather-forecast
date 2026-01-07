// SWR Hooks for Soundings Data

import useSWR from 'swr';
import {
  StationsResponse,
  InventoryResponse,
  SoundingResponse,
  RAOBStation,
  AircraftAirport,
} from '@/lib/soundings/types';

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
});

// Fetch all stations (RAOB + ACARS airports)
export function useSoundingStations(options?: {
  includeInactive?: boolean;
  conusOnly?: boolean;
}) {
  const params = new URLSearchParams();
  if (options?.includeInactive) params.set('include_inactive', 'true');
  if (options?.conusOnly === false) params.set('conus_only', 'false');

  const queryString = params.toString();
  const url = `/api/soundings/stations${queryString ? `?${queryString}` : ''}`;

  return useSWR<StationsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 3600000, // 1 hour
  });
}

// Fetch inventory for a specific station
export function useStationInventory(stationId: string | null, days: number = 7) {
  const url = stationId
    ? `/api/soundings/inventory?station_id=${stationId}&days=${days}`
    : null;

  return useSWR<InventoryResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300000, // 5 minutes
  });
}

// Fetch a specific sounding
export function useSounding(
  stationId: string | null,
  date?: string, // YYYY-MM-DD
  time?: string, // 00Z or 12Z
  source: 'uwyo' | 'igra' = 'uwyo'
) {
  let url: string | null = null;

  if (stationId) {
    const params = new URLSearchParams({ station_id: stationId, source });
    if (date) params.set('date', date);
    if (time) params.set('time', time);
    url = `/api/soundings/sounding?${params.toString()}`;
  }

  return useSWR<SoundingResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300000, // 5 minutes
  });
}

// Fetch latest sounding for a station
export function useLatestSounding(stationId: string | null) {
  const url = stationId
    ? `/api/soundings/sounding?station_id=${stationId}`
    : null;

  return useSWR<SoundingResponse>(url, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 1800000, // 30 minutes
    dedupingInterval: 300000, // 5 minutes
  });
}

// Helper hook to get station by ID from cached data
export function useStation(stationId: string | null) {
  const { data } = useSoundingStations();

  if (!stationId || !data) return null;

  // Check RAOB stations first
  const raobStation = data.raob_stations.find(
    s => s.id === stationId || s.wmo_id === stationId || s.icao === stationId
  );
  if (raobStation) return { type: 'raob' as const, station: raobStation };

  // Check ACARS airports
  const acarsAirport = data.acars_airports.find(
    a => a.icao === stationId || a.iata === stationId
  );
  if (acarsAirport) return { type: 'acars' as const, station: acarsAirport };

  return null;
}

// Convert stations to GeoJSON for map display
export function useStationsGeoJSON() {
  const { data, error, isLoading } = useSoundingStations();

  if (!data) {
    return {
      raobGeoJSON: null,
      acarsGeoJSON: null,
      error,
      isLoading,
    };
  }

  const raobGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: data.raob_stations.map(station => ({
      type: 'Feature' as const,
      properties: {
        id: station.id,
        wmo_id: station.wmo_id,
        icao: station.icao,
        name: station.name,
        state: station.state,
        elevation_m: station.elevation_m,
        obs_times: station.obs_times,
        type: 'raob',
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [station.lon, station.lat],
      },
    })),
  };

  const acarsGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: data.acars_airports.map(airport => ({
      type: 'Feature' as const,
      properties: {
        id: airport.icao,
        icao: airport.icao,
        iata: airport.iata,
        name: airport.name,
        city: airport.city,
        state: airport.state,
        elevation_ft: airport.elevation_ft,
        density: airport.typical_density,
        type: 'acars',
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [airport.lon, airport.lat],
      },
    })),
  };

  return {
    raobGeoJSON,
    acarsGeoJSON,
    error,
    isLoading,
  };
}
