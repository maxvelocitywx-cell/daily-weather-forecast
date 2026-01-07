import { NextResponse } from 'next/server';

export const maxDuration = 60;

// Station coordinates for major cities
const STATION_COORDS: Record<string, { lat: number; lon: number; city: string; state: string }> = {
  'ABQ': { lat: 35.04, lon: -106.61, city: 'Albuquerque', state: 'NM' },
  'ABR': { lat: 45.45, lon: -98.42, city: 'Aberdeen', state: 'SD' },
  'ABI': { lat: 32.41, lon: -99.68, city: 'Abilene', state: 'TX' },
  'ACT': { lat: 31.61, lon: -97.23, city: 'Waco', state: 'TX' },
  'ALB': { lat: 42.75, lon: -73.80, city: 'Albany', state: 'NY' },
  'AMA': { lat: 35.22, lon: -101.83, city: 'Amarillo', state: 'TX' },
  'ATL': { lat: 33.75, lon: -84.39, city: 'Atlanta', state: 'GA' },
  'AUS': { lat: 30.30, lon: -97.70, city: 'Austin', state: 'TX' },
  'BDL': { lat: 41.94, lon: -72.68, city: 'Hartford', state: 'CT' },
  'BHM': { lat: 33.57, lon: -86.75, city: 'Birmingham', state: 'AL' },
  'BIL': { lat: 45.81, lon: -108.54, city: 'Billings', state: 'MT' },
  'BIS': { lat: 46.77, lon: -100.75, city: 'Bismarck', state: 'ND' },
  'BNA': { lat: 36.12, lon: -86.68, city: 'Nashville', state: 'TN' },
  'BOI': { lat: 43.57, lon: -116.22, city: 'Boise', state: 'ID' },
  'BOS': { lat: 42.36, lon: -71.01, city: 'Boston', state: 'MA' },
  'BRO': { lat: 25.91, lon: -97.42, city: 'Brownsville', state: 'TX' },
  'BTR': { lat: 30.53, lon: -91.15, city: 'Baton Rouge', state: 'LA' },
  'BTV': { lat: 44.47, lon: -73.15, city: 'Burlington', state: 'VT' },
  'BUF': { lat: 42.94, lon: -78.74, city: 'Buffalo', state: 'NY' },
  'BWI': { lat: 39.18, lon: -76.67, city: 'Baltimore', state: 'MD' },
  'CAE': { lat: 33.94, lon: -81.12, city: 'Columbia', state: 'SC' },
  'CHA': { lat: 35.04, lon: -85.20, city: 'Chattanooga', state: 'TN' },
  'CHS': { lat: 32.90, lon: -80.04, city: 'Charleston', state: 'SC' },
  'CLE': { lat: 41.41, lon: -81.85, city: 'Cleveland', state: 'OH' },
  'CLT': { lat: 35.21, lon: -80.94, city: 'Charlotte', state: 'NC' },
  'CMH': { lat: 39.99, lon: -82.89, city: 'Columbus', state: 'OH' },
  'COS': { lat: 38.81, lon: -104.71, city: 'Colorado Springs', state: 'CO' },
  'CRP': { lat: 27.77, lon: -97.50, city: 'Corpus Christi', state: 'TX' },
  'CVG': { lat: 39.05, lon: -84.66, city: 'Cincinnati', state: 'OH' },
  'DAL': { lat: 32.85, lon: -96.85, city: 'Dallas Love Field', state: 'TX' },
  'DCA': { lat: 38.85, lon: -77.04, city: 'Washington DC', state: 'DC' },
  'DEN': { lat: 39.86, lon: -104.67, city: 'Denver', state: 'CO' },
  'DFW': { lat: 32.90, lon: -97.04, city: 'Dallas-Fort Worth', state: 'TX' },
  'DSM': { lat: 41.53, lon: -93.66, city: 'Des Moines', state: 'IA' },
  'DTW': { lat: 42.21, lon: -83.35, city: 'Detroit', state: 'MI' },
  'ELP': { lat: 31.81, lon: -106.38, city: 'El Paso', state: 'TX' },
  'EWR': { lat: 40.69, lon: -74.17, city: 'Newark', state: 'NJ' },
  'FAR': { lat: 46.90, lon: -96.80, city: 'Fargo', state: 'ND' },
  'FLL': { lat: 26.07, lon: -80.15, city: 'Fort Lauderdale', state: 'FL' },
  'GRB': { lat: 44.48, lon: -88.13, city: 'Green Bay', state: 'WI' },
  'GRR': { lat: 42.88, lon: -85.52, city: 'Grand Rapids', state: 'MI' },
  'GSO': { lat: 36.10, lon: -79.94, city: 'Greensboro', state: 'NC' },
  'HOU': { lat: 29.65, lon: -95.28, city: 'Houston Hobby', state: 'TX' },
  'IAD': { lat: 38.95, lon: -77.46, city: 'Washington Dulles', state: 'VA' },
  'IAH': { lat: 29.98, lon: -95.34, city: 'Houston', state: 'TX' },
  'ICT': { lat: 37.65, lon: -97.43, city: 'Wichita', state: 'KS' },
  'IND': { lat: 39.73, lon: -86.27, city: 'Indianapolis', state: 'IN' },
  'JAN': { lat: 32.32, lon: -90.08, city: 'Jackson', state: 'MS' },
  'JAX': { lat: 30.49, lon: -81.69, city: 'Jacksonville', state: 'FL' },
  'JFK': { lat: 40.64, lon: -73.78, city: 'New York JFK', state: 'NY' },
  'LAS': { lat: 36.08, lon: -115.15, city: 'Las Vegas', state: 'NV' },
  'LAX': { lat: 33.94, lon: -118.41, city: 'Los Angeles', state: 'CA' },
  'LBB': { lat: 33.66, lon: -101.82, city: 'Lubbock', state: 'TX' },
  'LIT': { lat: 34.73, lon: -92.22, city: 'Little Rock', state: 'AR' },
  'MCI': { lat: 39.30, lon: -94.71, city: 'Kansas City', state: 'MO' },
  'MCO': { lat: 28.43, lon: -81.31, city: 'Orlando', state: 'FL' },
  'MDW': { lat: 41.79, lon: -87.75, city: 'Chicago Midway', state: 'IL' },
  'MEM': { lat: 35.05, lon: -90.00, city: 'Memphis', state: 'TN' },
  'MIA': { lat: 25.79, lon: -80.29, city: 'Miami', state: 'FL' },
  'MKE': { lat: 42.95, lon: -87.90, city: 'Milwaukee', state: 'WI' },
  'MOB': { lat: 30.69, lon: -88.25, city: 'Mobile', state: 'AL' },
  'MSN': { lat: 43.14, lon: -89.34, city: 'Madison', state: 'WI' },
  'MSP': { lat: 44.88, lon: -93.22, city: 'Minneapolis', state: 'MN' },
  'MSY': { lat: 29.99, lon: -90.26, city: 'New Orleans', state: 'LA' },
  'OKC': { lat: 35.39, lon: -97.60, city: 'Oklahoma City', state: 'OK' },
  'OMA': { lat: 41.30, lon: -95.89, city: 'Omaha', state: 'NE' },
  'ORD': { lat: 41.98, lon: -87.90, city: 'Chicago', state: 'IL' },
  'PBI': { lat: 26.68, lon: -80.10, city: 'West Palm Beach', state: 'FL' },
  'PDX': { lat: 45.59, lon: -122.60, city: 'Portland', state: 'OR' },
  'PHL': { lat: 39.87, lon: -75.24, city: 'Philadelphia', state: 'PA' },
  'PHX': { lat: 33.43, lon: -112.02, city: 'Phoenix', state: 'AZ' },
  'PIT': { lat: 40.50, lon: -80.22, city: 'Pittsburgh', state: 'PA' },
  'PVD': { lat: 41.72, lon: -71.43, city: 'Providence', state: 'RI' },
  'RAP': { lat: 44.05, lon: -103.05, city: 'Rapid City', state: 'SD' },
  'RDU': { lat: 35.88, lon: -78.79, city: 'Raleigh-Durham', state: 'NC' },
  'RIC': { lat: 37.51, lon: -77.32, city: 'Richmond', state: 'VA' },
  'RNO': { lat: 39.50, lon: -119.77, city: 'Reno', state: 'NV' },
  'SAC': { lat: 38.70, lon: -121.59, city: 'Sacramento', state: 'CA' },
  'SAN': { lat: 32.73, lon: -117.19, city: 'San Diego', state: 'CA' },
  'SAT': { lat: 29.53, lon: -98.47, city: 'San Antonio', state: 'TX' },
  'SAV': { lat: 32.13, lon: -81.20, city: 'Savannah', state: 'GA' },
  'SDF': { lat: 38.17, lon: -85.74, city: 'Louisville', state: 'KY' },
  'SEA': { lat: 47.45, lon: -122.31, city: 'Seattle', state: 'WA' },
  'SFO': { lat: 37.62, lon: -122.38, city: 'San Francisco', state: 'CA' },
  'SGF': { lat: 37.24, lon: -93.39, city: 'Springfield', state: 'MO' },
  'SHV': { lat: 32.45, lon: -93.82, city: 'Shreveport', state: 'LA' },
  'SJC': { lat: 37.36, lon: -121.93, city: 'San Jose', state: 'CA' },
  'SLC': { lat: 40.79, lon: -111.98, city: 'Salt Lake City', state: 'UT' },
  'STL': { lat: 38.75, lon: -90.37, city: 'St. Louis', state: 'MO' },
  'TPA': { lat: 27.98, lon: -82.53, city: 'Tampa', state: 'FL' },
  'TUL': { lat: 36.20, lon: -95.89, city: 'Tulsa', state: 'OK' },
  'TUS': { lat: 32.13, lon: -110.96, city: 'Tucson', state: 'AZ' },
};

interface RecordStation {
  id: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  fcstTemp: number;
  recordTemp: number;
  recordYear: number;
  diff: number;
}

interface RecordsData {
  [key: string]: {
    himax: RecordStation[];
    lomin: RecordStation[];
    lomax: RecordStation[];
    himin: RecordStation[];
  };
}

// Cache for records data
let recordsCache: {
  data: RecordsData | null;
  lastUpdated: Date | null;
} = {
  data: null,
  lastUpdated: null,
};

// Cache TTL: 30 minutes
const CACHE_TTL = 30 * 60 * 1000;

async function fetchRecordsFromGeoJSON(): Promise<RecordsData> {
  console.log('Fetching NDFD records from WPC GeoJSON files...');

  const baseUrl = 'https://www.wpc.ncep.noaa.gov/exper/ndfd/';
  const types = ['himax', 'lomin', 'lomax', 'himin'] as const;
  const days = [1, 2, 3, 4, 5, 6, 7];

  const results: RecordsData = {};

  for (const day of days) {
    results[`d${day}`] = {
      himax: [],
      lomin: [],
      lomax: [],
      himin: [],
    };

    for (const type of types) {
      try {
        const url = `${baseUrl}ndfd.${type}.d${day}.geojson`;
        const response = await fetch(url, {
          next: { revalidate: 1800 }, // Cache for 30 minutes
          headers: {
            'User-Agent': 'MaxVelocity-Weather/1.0',
          },
        });

        if (response.ok) {
          const geojson = await response.json();

          // Parse the GeoJSON features
          const stations: RecordStation[] = geojson.features.map((feature: {
            properties: Record<string, string | number>;
            geometry: { coordinates: [number, number] };
          }) => {
            const props = feature.properties;
            const coords = feature.geometry.coordinates;
            const stationId = String(props.ID);
            const stationCoords = STATION_COORDS[stationId];

            return {
              id: stationId,
              city: stationCoords?.city || String(props.Name).replace(/_/g, ' '),
              state: stationCoords?.state || '',
              lat: coords[1],
              lon: coords[0],
              fcstTemp: parseInt(String(props.ndfdtemp)) || 0,
              recordTemp: parseInt(String(props[`rec${type}`])) || 0,
              recordYear: parseInt(String(props[`rec${type}yy`])) || 0,
              diff: (parseInt(String(props.ndfdtemp)) || 0) - (parseInt(String(props[`rec${type}`])) || 0),
            };
          });

          results[`d${day}`][type] = stations;
          console.log(`Loaded ${stations.length} ${type} records for day ${day}`);
        } else {
          console.log(`No data found for ${type} day ${day} (${response.status})`);
        }
      } catch (error) {
        console.log(`Error fetching ${type} day ${day}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }

  return results;
}

export async function GET() {
  try {
    // Check cache
    const now = new Date();
    if (
      recordsCache.data &&
      recordsCache.lastUpdated &&
      now.getTime() - recordsCache.lastUpdated.getTime() < CACHE_TTL
    ) {
      return NextResponse.json({
        data: recordsCache.data,
        lastUpdated: recordsCache.lastUpdated.toISOString(),
        source: 'WPC NDFD Records (cached)',
      });
    }

    // Fetch fresh data
    const data = await fetchRecordsFromGeoJSON();

    // Update cache
    recordsCache = {
      data,
      lastUpdated: now,
    };

    return NextResponse.json({
      data,
      lastUpdated: now.toISOString(),
      source: 'WPC NDFD Records',
    });
  } catch (error) {
    console.error('Error in NDFD records API:', error);

    // Return cached data if available
    if (recordsCache.data) {
      return NextResponse.json({
        data: recordsCache.data,
        lastUpdated: recordsCache.lastUpdated?.toISOString(),
        source: 'WPC NDFD Records (stale cache)',
        error: 'Failed to fetch fresh data',
      });
    }

    return NextResponse.json(
      { error: 'Failed to fetch NDFD records' },
      { status: 500 }
    );
  }
}
