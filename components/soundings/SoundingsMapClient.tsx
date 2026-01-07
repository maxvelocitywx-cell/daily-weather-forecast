'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { RAOBStation, AircraftAirport } from '@/lib/soundings/types';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';

interface SoundingsMapClientProps {
  raobStations: RAOBStation[];
  acarsAirports: AircraftAirport[];
  selectedStation: RAOBStation | null;
  selectedAirport: AircraftAirport | null;
  onStationSelect: (station: RAOBStation) => void;
  onAirportSelect: (airport: AircraftAirport) => void;
}

export default function SoundingsMapClient({
  raobStations,
  acarsAirports,
  selectedStation,
  selectedAirport,
  onStationSelect,
  onAirportSelect,
}: SoundingsMapClientProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98.5, 39.8],
      zoom: 3.8,
      minZoom: 2.5,
      maxZoom: 10,
      attributionControl: false,
    });

    map.current.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      'top-right'
    );

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Add/update station layers when data changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const mapInstance = map.current;

    // RAOB stations GeoJSON
    const raobGeoJSON: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: raobStations.map((station) => ({
        type: 'Feature' as const,
        properties: {
          id: station.id,
          name: station.name,
          state: station.state,
          wmo_id: station.wmo_id,
          icao: station.icao,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [station.lon, station.lat],
        },
      })),
    };

    // ACARS airports GeoJSON
    const acarsGeoJSON: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: acarsAirports.map((airport) => ({
        type: 'Feature' as const,
        properties: {
          id: airport.icao,
          name: airport.name,
          city: airport.city,
          state: airport.state,
          density: airport.typical_density,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [airport.lon, airport.lat],
        },
      })),
    };

    // Add or update RAOB source
    const raobSource = mapInstance.getSource('raob-stations') as mapboxgl.GeoJSONSource;
    if (raobSource) {
      raobSource.setData(raobGeoJSON);
    } else {
      mapInstance.addSource('raob-stations', {
        type: 'geojson',
        data: raobGeoJSON,
      });

      // RAOB circles layer
      mapInstance.addLayer({
        id: 'raob-circles',
        type: 'circle',
        source: 'raob-stations',
        paint: {
          'circle-radius': 8,
          'circle-color': '#3b82f6', // mv-accent-blue
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      });

      // RAOB labels
      mapInstance.addLayer({
        id: 'raob-labels',
        type: 'symbol',
        source: 'raob-stations',
        layout: {
          'text-field': ['get', 'icao'],
          'text-size': 10,
          'text-offset': [0, 1.5],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#b0b0c0',
          'text-halo-color': '#0a0a0f',
          'text-halo-width': 1,
        },
        minzoom: 5,
      });
    }

    // Add or update ACARS source
    const acarsSource = mapInstance.getSource('acars-airports') as mapboxgl.GeoJSONSource;
    if (acarsSource) {
      acarsSource.setData(acarsGeoJSON);
    } else {
      mapInstance.addSource('acars-airports', {
        type: 'geojson',
        data: acarsGeoJSON,
      });

      // ACARS circles layer
      mapInstance.addLayer({
        id: 'acars-circles',
        type: 'circle',
        source: 'acars-airports',
        paint: {
          'circle-radius': [
            'match',
            ['get', 'density'],
            'high', 7,
            'medium', 5,
            'low', 4,
            5,
          ],
          'circle-color': '#a855f7', // mv-accent-purple
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.8,
        },
      });

      // ACARS labels
      mapInstance.addLayer({
        id: 'acars-labels',
        type: 'symbol',
        source: 'acars-airports',
        layout: {
          'text-field': ['get', 'id'],
          'text-size': 9,
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#a855f7',
          'text-halo-color': '#0a0a0f',
          'text-halo-width': 1,
        },
        minzoom: 6,
      });
    }

    // Click handlers for RAOB
    mapInstance.on('click', 'raob-circles', (e) => {
      if (e.features && e.features[0]) {
        const props = e.features[0].properties;
        const station = raobStations.find((s) => s.id === props?.id);
        if (station) {
          onStationSelect(station);
        }
      }
    });

    // Click handlers for ACARS
    mapInstance.on('click', 'acars-circles', (e) => {
      if (e.features && e.features[0]) {
        const props = e.features[0].properties;
        const airport = acarsAirports.find((a) => a.icao === props?.id);
        if (airport) {
          onAirportSelect(airport);
        }
      }
    });

    // Hover effects
    mapInstance.on('mouseenter', 'raob-circles', () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    });
    mapInstance.on('mouseleave', 'raob-circles', () => {
      mapInstance.getCanvas().style.cursor = '';
    });
    mapInstance.on('mouseenter', 'acars-circles', () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    });
    mapInstance.on('mouseleave', 'acars-circles', () => {
      mapInstance.getCanvas().style.cursor = '';
    });
  }, [raobStations, acarsAirports, mapLoaded, onStationSelect, onAirportSelect]);

  // Highlight selected station/airport
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const mapInstance = map.current;

    // Remove previous highlight layer if exists
    if (mapInstance.getLayer('selected-highlight')) {
      mapInstance.removeLayer('selected-highlight');
    }
    if (mapInstance.getSource('selected-station')) {
      mapInstance.removeSource('selected-station');
    }

    // Add highlight for selected station or airport
    if (selectedStation || selectedAirport) {
      const coords = selectedStation
        ? [selectedStation.lon, selectedStation.lat]
        : [selectedAirport!.lon, selectedAirport!.lat];

      mapInstance.addSource('selected-station', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: coords,
          },
        },
      });

      mapInstance.addLayer({
        id: 'selected-highlight',
        type: 'circle',
        source: 'selected-station',
        paint: {
          'circle-radius': 14,
          'circle-color': 'transparent',
          'circle-stroke-color': '#22d3ee', // mv-accent-cyan
          'circle-stroke-width': 3,
          'circle-opacity': 1,
        },
      });

      // Fly to selected location
      mapInstance.flyTo({
        center: coords as [number, number],
        zoom: Math.max(mapInstance.getZoom(), 6),
        duration: 500,
      });
    }
  }, [selectedStation, selectedAirport, mapLoaded]);

  return (
    <div ref={mapContainer} className="w-full h-full" />
  );
}
