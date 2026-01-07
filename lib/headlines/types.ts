/**
 * Headlines System Types - Strict Fact-Based Version
 *
 * All headlines MUST be backed by verified facts from the facts bundle.
 * No hallucination allowed - every claim must trace to a source.
 */

// ============================================================================
// VERIFIED FACT TYPES
// ============================================================================

export type FactSource =
  | 'nws_alert'      // NWS /alerts/active
  | 'lsr'            // IEM Local Storm Reports
  | 'station_obs'    // NWS station observations (measured)
  | 'spc_outlook'    // SPC Convective Outlook
  | 'spc_md'         // SPC Mesoscale Discussion
  | 'wpc_ero'        // WPC Excessive Rainfall Outlook
  | 'nhc_tropical';  // NHC Tropical products

export type ConfidenceLabel = 'Measured' | 'Reported' | 'High' | 'Medium' | 'Low';

// Backward-compatible aliases for UI components
export type HeadlineConfidence = 'measured' | 'reported' | 'surveyed' | 'high' | 'medium' | 'low';

// ============================================================================
// LEGACY TYPES (for backward compatibility with old fetchers)
// ============================================================================

export type EventFactType =
  | 'tornado_report'
  | 'tornado_rating'
  | 'wind_gust'
  | 'hail'
  | 'flash_flood'
  | 'flood'
  | 'snowfall'
  | 'ice_accumulation'
  | 'temperature_extreme'
  | 'damage'
  | 'marine_hazard'
  | 'lightning'
  | 'other';

export type EventFactConfidence = 'measured' | 'reported' | 'surveyed' | 'estimated';

export interface EventFact {
  id: string;
  type: EventFactType;
  magnitude: number | string | null;
  units: string | null;
  location_name: string;
  lat: number;
  lon: number;
  state: string;
  timestamp_utc: string;
  source_name: string;
  source_url: string;
  confidence: EventFactConfidence;
  remarks?: string;
}

export interface AlertFact {
  event: string;
  severity: string;
  urgency: string;
  headline: string | null;
  areas: string[];
  states: string[];
  population: number;
  source_url: string;
}

export interface SPCFact {
  day: 1 | 2 | 3;
  max_category: string;
  categorical_areas: string[];
  source_url: string;
}

export interface SPCMDFact {
  md_number: string;
  concern: string;
  areas: string[];
  valid_time: string;
  source_url: string;
}

export interface EROFact {
  day: 1 | 2 | 3;
  max_category: string;
  areas: string[];
  source_url: string;
}

export interface TropicalFact {
  system_name: string;
  classification: string;
  max_wind: number;
  movement: string;
  threat_areas: string[];
  source_url: string;
}

// Legacy FactsBundle (used by old fetchers)
export interface LegacyFactsBundle {
  generated_at: string;
  event_facts: EventFact[];
  alerts: AlertFact[];
  spc_outlooks: SPCFact[];
  spc_mds: SPCMDFact[];
  ero_outlooks: EROFact[];
  tropical: TropicalFact[];
  total_active_alerts: number;
  total_event_facts: number;
  top_events: string[];
}

/**
 * A verified fact from a live data source.
 * All required fields MUST be present - facts missing fields are rejected.
 */
export interface VerifiedFact {
  // Unique identifier for this fact
  id: string;

  // Source tracking (required)
  source: FactSource;
  source_name: string;      // e.g., "NWS OKC", "IEM LSR", "ASOS KJFK"
  source_url: string;       // Must be a real URL to the source

  // Confidence based on source type
  confidence: ConfidenceLabel;

  // Event details
  event_type: string;       // e.g., "Tornado Warning", "wind_gust", "hail"

  // Numeric values (only if present in source)
  magnitude?: number;       // e.g., 95 for 95 mph
  units?: string;           // e.g., "mph", "inches"

  // Location (required, from source)
  location: {
    state: string;          // Full state name
    state_abbrev: string;   // Two-letter abbreviation
    place: string;          // City, county, or area
    lat?: number;
    lon?: number;
  };

  // Timing
  timestamp_utc: string;    // ISO 8601

  // For alerts
  alert_id?: string;
  sender_name?: string;     // e.g., "NWS Norman OK"
  area_desc?: string;       // From alert.properties.areaDesc

  // For station observations (Measured only)
  station_id?: string;      // e.g., "KJFK"

  // Raw excerpt from source (for verification)
  raw_excerpt?: string;
}

// ============================================================================
// FACTS BUNDLE
// ============================================================================

export interface FactsBundle {
  generated_at: string;
  facts: VerifiedFact[];

  // Lookup map for validation
  fact_ids: Set<string>;

  // Counts by source
  counts: {
    alerts: number;
    lsr: number;
    station_obs: number;
    spc: number;
    wpc: number;
    nhc: number;
  };

  // Validation stats
  validation: {
    total_fetched: number;
    passed: number;
    rejected: number;
    rejection_reasons: string[];
  };
}

// ============================================================================
// HEADLINE TYPES
// ============================================================================

export type HeadlineTopic =
  | 'severe'
  | 'winter'
  | 'flood'
  | 'tropical'
  | 'heat'
  | 'fire'
  | 'aviation'
  | 'marine'
  | 'general';

export interface Headline {
  id: string;
  headline: string;         // max 90 chars
  topic: HeadlineTopic;
  confidence_label: ConfidenceLabel;
  location: {
    state: string;
    place: string;
  };
  timestamp_utc: string;
  source_name: string;
  source_url: string;
  fact_ids: string[];       // References to facts in bundle - REQUIRED
}

export interface HeadlinesRun {
  id: string;
  timestamp: string;
  headlines: Headline[];
  facts_summary?: string;
  validation?: {
    facts_used: number;
    headlines_validated: boolean;
  };
}

// ============================================================================
// OPENAI RESPONSE SCHEMA - Strict fact references
// ============================================================================

export const HeadlinesSchema = {
  type: 'object',
  properties: {
    headlines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique headline ID (e.g., h1, h2, ...)',
          },
          headline: {
            type: 'string',
            description: 'Headline text, max 90 characters. Any numbers MUST come from referenced facts.',
          },
          topic: {
            type: 'string',
            enum: ['severe', 'winter', 'flood', 'tropical', 'heat', 'fire', 'aviation', 'marine', 'general'],
          },
          confidence_label: {
            type: 'string',
            enum: ['Measured', 'Reported', 'High', 'Medium', 'Low'],
            description: 'Measured=station obs with station_id ONLY, Reported=LSR, High/Medium/Low=alerts/outlooks',
          },
          location: {
            type: 'object',
            properties: {
              state: { type: 'string', description: 'Full state name from the fact' },
              place: { type: 'string', description: 'City/county/area from the fact' },
            },
            required: ['state', 'place'],
            additionalProperties: false,
          },
          timestamp_utc: {
            type: 'string',
            description: 'ISO 8601 timestamp from the referenced fact',
          },
          source_name: {
            type: 'string',
            description: 'EXACT source_name from the referenced fact',
          },
          source_url: {
            type: 'string',
            description: 'EXACT source_url from the referenced fact',
          },
          fact_ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'Array of fact IDs from the bundle that back this headline. REQUIRED - must exist in bundle.',
          },
        },
        required: ['id', 'headline', 'topic', 'confidence_label', 'location', 'timestamp_utc', 'source_name', 'source_url', 'fact_ids'],
        additionalProperties: false,
      },
      minItems: 10,
      maxItems: 10,
    },
  },
  required: ['headlines'],
  additionalProperties: false,
} as const;

// ============================================================================
// STATION METADATA (for geography validation)
// ============================================================================

export interface StationMetadata {
  id: string;           // e.g., "KJFK"
  name: string;         // e.g., "John F Kennedy International Airport"
  state: string;        // Full state name
  state_abbrev: string; // Two-letter
  city: string;
  lat: number;
  lon: number;
}

// Curated station list with verified metadata
export const STATION_METADATA: Record<string, StationMetadata> = {
  // Northeast
  'KJFK': { id: 'KJFK', name: 'JFK International', state: 'New York', state_abbrev: 'NY', city: 'New York', lat: 40.64, lon: -73.78 },
  'KLGA': { id: 'KLGA', name: 'LaGuardia', state: 'New York', state_abbrev: 'NY', city: 'New York', lat: 40.78, lon: -73.88 },
  'KEWR': { id: 'KEWR', name: 'Newark Liberty', state: 'New Jersey', state_abbrev: 'NJ', city: 'Newark', lat: 40.69, lon: -74.17 },
  'KBOS': { id: 'KBOS', name: 'Logan International', state: 'Massachusetts', state_abbrev: 'MA', city: 'Boston', lat: 42.36, lon: -71.01 },
  'KPHL': { id: 'KPHL', name: 'Philadelphia International', state: 'Pennsylvania', state_abbrev: 'PA', city: 'Philadelphia', lat: 39.87, lon: -75.24 },
  'KDCA': { id: 'KDCA', name: 'Reagan National', state: 'Virginia', state_abbrev: 'VA', city: 'Washington', lat: 38.85, lon: -77.04 },
  'KIAD': { id: 'KIAD', name: 'Dulles International', state: 'Virginia', state_abbrev: 'VA', city: 'Washington', lat: 38.94, lon: -77.46 },
  'KBWI': { id: 'KBWI', name: 'Baltimore-Washington', state: 'Maryland', state_abbrev: 'MD', city: 'Baltimore', lat: 39.18, lon: -76.67 },

  // Southeast
  'KATL': { id: 'KATL', name: 'Hartsfield-Jackson', state: 'Georgia', state_abbrev: 'GA', city: 'Atlanta', lat: 33.64, lon: -84.43 },
  'KMIA': { id: 'KMIA', name: 'Miami International', state: 'Florida', state_abbrev: 'FL', city: 'Miami', lat: 25.79, lon: -80.29 },
  'KTPA': { id: 'KTPA', name: 'Tampa International', state: 'Florida', state_abbrev: 'FL', city: 'Tampa', lat: 27.98, lon: -82.53 },
  'KMCO': { id: 'KMCO', name: 'Orlando International', state: 'Florida', state_abbrev: 'FL', city: 'Orlando', lat: 28.43, lon: -81.31 },
  'KCLT': { id: 'KCLT', name: 'Charlotte Douglas', state: 'North Carolina', state_abbrev: 'NC', city: 'Charlotte', lat: 35.21, lon: -80.94 },
  'KRDU': { id: 'KRDU', name: 'Raleigh-Durham', state: 'North Carolina', state_abbrev: 'NC', city: 'Raleigh', lat: 35.88, lon: -78.79 },
  'KBNA': { id: 'KBNA', name: 'Nashville International', state: 'Tennessee', state_abbrev: 'TN', city: 'Nashville', lat: 36.12, lon: -86.68 },
  'KMEM': { id: 'KMEM', name: 'Memphis International', state: 'Tennessee', state_abbrev: 'TN', city: 'Memphis', lat: 35.04, lon: -89.98 },
  'KMSY': { id: 'KMSY', name: 'Louis Armstrong', state: 'Louisiana', state_abbrev: 'LA', city: 'New Orleans', lat: 29.99, lon: -90.26 },

  // Midwest
  'KORD': { id: 'KORD', name: "O'Hare International", state: 'Illinois', state_abbrev: 'IL', city: 'Chicago', lat: 41.98, lon: -87.90 },
  'KMDW': { id: 'KMDW', name: 'Midway International', state: 'Illinois', state_abbrev: 'IL', city: 'Chicago', lat: 41.79, lon: -87.75 },
  'KDTW': { id: 'KDTW', name: 'Detroit Metro', state: 'Michigan', state_abbrev: 'MI', city: 'Detroit', lat: 42.21, lon: -83.35 },
  'KCLE': { id: 'KCLE', name: 'Cleveland Hopkins', state: 'Ohio', state_abbrev: 'OH', city: 'Cleveland', lat: 41.41, lon: -81.85 },
  'KCMH': { id: 'KCMH', name: 'John Glenn Columbus', state: 'Ohio', state_abbrev: 'OH', city: 'Columbus', lat: 39.99, lon: -82.89 },
  'KIND': { id: 'KIND', name: 'Indianapolis International', state: 'Indiana', state_abbrev: 'IN', city: 'Indianapolis', lat: 39.72, lon: -86.29 },
  'KMSP': { id: 'KMSP', name: 'Minneapolis-St Paul', state: 'Minnesota', state_abbrev: 'MN', city: 'Minneapolis', lat: 44.88, lon: -93.22 },
  'KMCI': { id: 'KMCI', name: 'Kansas City International', state: 'Missouri', state_abbrev: 'MO', city: 'Kansas City', lat: 39.30, lon: -94.71 },
  'KSTL': { id: 'KSTL', name: 'St Louis Lambert', state: 'Missouri', state_abbrev: 'MO', city: 'St. Louis', lat: 38.75, lon: -90.37 },

  // South Central / Tornado Alley
  'KDFW': { id: 'KDFW', name: 'DFW International', state: 'Texas', state_abbrev: 'TX', city: 'Dallas', lat: 32.90, lon: -97.04 },
  'KDAL': { id: 'KDAL', name: 'Dallas Love Field', state: 'Texas', state_abbrev: 'TX', city: 'Dallas', lat: 32.85, lon: -96.85 },
  'KIAH': { id: 'KIAH', name: 'George Bush Intercontinental', state: 'Texas', state_abbrev: 'TX', city: 'Houston', lat: 29.98, lon: -95.34 },
  'KHOU': { id: 'KHOU', name: 'Houston Hobby', state: 'Texas', state_abbrev: 'TX', city: 'Houston', lat: 29.65, lon: -95.28 },
  'KSAT': { id: 'KSAT', name: 'San Antonio International', state: 'Texas', state_abbrev: 'TX', city: 'San Antonio', lat: 29.53, lon: -98.47 },
  'KAUS': { id: 'KAUS', name: 'Austin-Bergstrom', state: 'Texas', state_abbrev: 'TX', city: 'Austin', lat: 30.19, lon: -97.67 },
  'KOKC': { id: 'KOKC', name: 'Will Rogers World', state: 'Oklahoma', state_abbrev: 'OK', city: 'Oklahoma City', lat: 35.39, lon: -97.60 },
  'KTUL': { id: 'KTUL', name: 'Tulsa International', state: 'Oklahoma', state_abbrev: 'OK', city: 'Tulsa', lat: 36.20, lon: -95.89 },
  'KICT': { id: 'KICT', name: 'Wichita Eisenhower', state: 'Kansas', state_abbrev: 'KS', city: 'Wichita', lat: 37.65, lon: -97.43 },
  'KOMA': { id: 'KOMA', name: 'Eppley Airfield', state: 'Nebraska', state_abbrev: 'NE', city: 'Omaha', lat: 41.30, lon: -95.89 },
  'KLIT': { id: 'KLIT', name: 'Clinton National', state: 'Arkansas', state_abbrev: 'AR', city: 'Little Rock', lat: 34.73, lon: -92.22 },

  // Mountain West
  'KDEN': { id: 'KDEN', name: 'Denver International', state: 'Colorado', state_abbrev: 'CO', city: 'Denver', lat: 39.86, lon: -104.67 },
  'KSLC': { id: 'KSLC', name: 'Salt Lake City International', state: 'Utah', state_abbrev: 'UT', city: 'Salt Lake City', lat: 40.79, lon: -111.98 },
  'KABQ': { id: 'KABQ', name: 'Albuquerque International', state: 'New Mexico', state_abbrev: 'NM', city: 'Albuquerque', lat: 35.04, lon: -106.61 },
  'KPHX': { id: 'KPHX', name: 'Phoenix Sky Harbor', state: 'Arizona', state_abbrev: 'AZ', city: 'Phoenix', lat: 33.43, lon: -112.01 },
  'KLAS': { id: 'KLAS', name: 'Harry Reid International', state: 'Nevada', state_abbrev: 'NV', city: 'Las Vegas', lat: 36.08, lon: -115.15 },

  // West Coast
  'KLAX': { id: 'KLAX', name: 'Los Angeles International', state: 'California', state_abbrev: 'CA', city: 'Los Angeles', lat: 33.94, lon: -118.41 },
  'KSFO': { id: 'KSFO', name: 'San Francisco International', state: 'California', state_abbrev: 'CA', city: 'San Francisco', lat: 37.62, lon: -122.38 },
  'KSAN': { id: 'KSAN', name: 'San Diego International', state: 'California', state_abbrev: 'CA', city: 'San Diego', lat: 32.73, lon: -117.19 },
  'KSEA': { id: 'KSEA', name: 'Seattle-Tacoma International', state: 'Washington', state_abbrev: 'WA', city: 'Seattle', lat: 47.45, lon: -122.31 },
  'KPDX': { id: 'KPDX', name: 'Portland International', state: 'Oregon', state_abbrev: 'OR', city: 'Portland', lat: 45.59, lon: -122.60 },
};
