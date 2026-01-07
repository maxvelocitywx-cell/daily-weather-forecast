import { RegionId, RegionDefinition } from './types';

export const REGIONS: Record<RegionId, RegionDefinition> = {
  northeast: {
    id: 'northeast',
    name: 'Northeast',
    shortName: 'NE',
    states: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC'],
    center: { lat: 42.0, lon: -74.5 },
    bounds: { north: 47.5, south: 38.5, east: -66.5, west: -80.5 },
  },
  southeast: {
    id: 'southeast',
    name: 'Southeast',
    shortName: 'SE',
    states: ['VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'AL', 'MS', 'TN', 'KY'],
    center: { lat: 33.5, lon: -84.0 },
    bounds: { north: 39.5, south: 24.5, east: -75.0, west: -92.0 },
  },
  midwest: {
    id: 'midwest',
    name: 'Midwest',
    shortName: 'MW',
    states: ['OH', 'MI', 'IN', 'IL', 'WI', 'MN', 'IA', 'MO'],
    center: { lat: 42.0, lon: -88.0 },
    bounds: { north: 49.5, south: 36.0, east: -80.5, west: -97.5 },
  },
  southern_plains: {
    id: 'southern_plains',
    name: 'Southern Plains',
    shortName: 'SP',
    states: ['TX', 'OK', 'KS', 'AR', 'LA'],
    center: { lat: 33.0, lon: -98.0 },
    bounds: { north: 40.0, south: 25.5, east: -89.0, west: -106.5 },
  },
  northern_plains: {
    id: 'northern_plains',
    name: 'Northern Plains',
    shortName: 'NP',
    states: ['ND', 'SD', 'NE', 'MT', 'WY'],
    center: { lat: 44.5, lon: -104.0 },
    bounds: { north: 49.0, south: 40.0, east: -96.0, west: -116.0 },
  },
  northwest: {
    id: 'northwest',
    name: 'Northwest',
    shortName: 'NW',
    states: ['WA', 'OR', 'ID'],
    center: { lat: 45.5, lon: -120.0 },
    bounds: { north: 49.0, south: 41.5, east: -111.0, west: -125.0 },
  },
  southwest: {
    id: 'southwest',
    name: 'Southwest',
    shortName: 'SW',
    states: ['CA', 'NV', 'AZ', 'NM', 'UT', 'CO'],
    center: { lat: 36.0, lon: -114.0 },
    bounds: { north: 42.0, south: 31.0, east: -102.0, west: -125.0 },
  },
};

export const REGION_IDS = Object.keys(REGIONS) as RegionId[];

// Ordered list for display purposes (can be customized)
export const REGION_ORDER: RegionId[] = [
  'northeast',
  'southeast',
  'midwest',
  'southern_plains',
  'northern_plains',
  'northwest',
  'southwest',
];

export function getRegionById(id: RegionId): RegionDefinition | undefined {
  return REGIONS[id];
}

export function getRegionForState(stateAbbr: string): RegionId | undefined {
  for (const [regionId, region] of Object.entries(REGIONS)) {
    if (region.states.includes(stateAbbr.toUpperCase())) {
      return regionId as RegionId;
    }
  }
  return undefined;
}
