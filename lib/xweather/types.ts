/**
 * Xweather Headlines System Types
 *
 * Strict fact-based headline generation using Xweather API as the primary data source.
 * All headlines MUST be backed by verified facts from the Facts Bundle.
 */

// ============================================================================
// XWEATHER FACT TYPES
// ============================================================================

export type XweatherFactType =
  | 'measured_wind'      // From observations API - wind gust/speed
  | 'measured_temp'      // From observations API - temperature
  | 'measured_pressure'  // From observations API - pressure
  | 'reported_wind'      // From storm reports - wind damage/gust
  | 'reported_hail'      // From storm reports - hail
  | 'tornado_report'     // From storm reports - tornado
  | 'flood_report'       // From storm reports - flood
  | 'alert'              // From alerts API - warnings/watches
  | 'winter_event'       // Winter weather events
  | 'fire_event'         // Fire weather events
  | 'tropical_event'     // Tropical weather events
  | 'general';           // Other events

export type XweatherConfidence = 'measured' | 'reported' | 'forecast';

/**
 * A verified fact from Xweather API.
 * Every fact MUST have all required fields - facts missing fields are rejected.
 */
export interface XweatherFact {
  // Unique identifier for this fact
  fact_id: string;

  // Type classification
  type: XweatherFactType;

  // Value and units (required for measured/reported facts)
  value: number | string | null;
  units: 'mph' | 'in' | '°F' | 'mb' | 'kt' | null;

  // Location (required)
  location: {
    name: string;       // City/place name
    state: string;      // Full state name
    state_abbrev: string; // Two-letter abbreviation
    lat: number;
    lon: number;
  };

  // Timing
  timestamp_utc: string;  // ISO 8601

  // Confidence based on source type
  confidence: XweatherConfidence;

  // Source tracking (required)
  source_name: 'Xweather';
  source_url: string;

  // Additional metadata
  station_id?: string;      // For measured observations
  alert_type?: string;      // For alerts (e.g., "Tornado Warning")
  severity?: string;        // For alerts
  raw_data?: string;        // Raw excerpt for verification
}

// ============================================================================
// XWEATHER FACTS BUNDLE
// ============================================================================

export interface XweatherFactsBundle {
  generated_at: string;
  facts: XweatherFact[];

  // Lookup map for validation
  fact_ids: Set<string>;

  // Counts by type
  counts: {
    observations: number;
    storm_reports: number;
    alerts: number;
    total: number;
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
  | 'general';

export type HeadlineConfidenceLabel = 'Measured' | 'Reported' | 'Forecast';

export interface XweatherHeadline {
  headline: string;           // max 90 chars
  topic: HeadlineTopic;
  confidence_label: HeadlineConfidenceLabel;
  regions: string[];          // Array of affected regions/states
  fact_ids: string[];         // References to facts in bundle - REQUIRED
  source_url: string;
}

export interface HeadlinesRun {
  id: string;
  timestamp: string;
  headlines: XweatherHeadline[];
  facts_summary: string;
  validation: {
    facts_used: number;
    headlines_validated: boolean;
  };
}

// ============================================================================
// OPENAI RESPONSE SCHEMA - Strict fact references
// ============================================================================

export const XweatherHeadlinesSchema = {
  type: 'object',
  properties: {
    headlines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          headline: {
            type: 'string',
            description: 'Headline text, max 90 characters. Any numbers MUST match exactly from referenced facts.',
          },
          topic: {
            type: 'string',
            enum: ['severe', 'winter', 'flood', 'tropical', 'heat', 'fire', 'general'],
          },
          confidence_label: {
            type: 'string',
            enum: ['Measured', 'Reported', 'Forecast'],
            description: 'Measured=observations only, Reported=storm reports, Forecast=alerts/outlooks',
          },
          regions: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'Array of affected states (e.g., ["Texas", "Oklahoma"])',
          },
          fact_ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'Array of fact_id values from the bundle. REQUIRED - must exist in bundle.',
          },
          source_url: {
            type: 'string',
            description: 'URL from the primary referenced fact',
          },
        },
        required: ['headline', 'topic', 'confidence_label', 'regions', 'fact_ids', 'source_url'],
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
// XWEATHER API RESPONSE TYPES
// ============================================================================

export interface XweatherObservation {
  id: string;
  loc: {
    lat: number;
    long: number;
  };
  place: {
    name: string;
    state: string;
    country: string;
  };
  ob: {
    timestamp: number;
    dateTimeISO: string;
    tempF: number | null;
    tempC: number | null;
    feelslikeF: number | null;
    humidity: number | null;
    pressureMB: number | null;
    pressureIN: number | null;
    windSpeedMPH: number | null;
    windSpeedKTS: number | null;
    windGustMPH: number | null;
    windDir: string | null;
    windDirDEG: number | null;
    weather: string | null;
    weatherCoded: string | null;
    visibilityMI: number | null;
  };
}

export interface XweatherStormReport {
  id: string;
  report: {
    type: string;           // 'tornado', 'hail', 'wind', 'flood', etc.
    code: string;
    name: string;
    cat: string;
    dateTimeISO: string;
    timestamp: number;
    comments: string | null;
  };
  loc: {
    lat: number;
    long: number;
  };
  place: {
    name: string;
    state: string;
    country: string;
  };
  detail?: {
    magnitude?: number;
    magUnit?: string;
  };
}

export interface XweatherAlert {
  id: string;
  details: {
    type: string;
    name: string;
    body: string;
    bodyFull: string;
  };
  timestamps: {
    issued: number;
    issuedISO: string;
    begins: number;
    beginsISO: string;
    expires: number;
    expiresISO: string;
  };
  place: {
    name: string;
    state: string;
    country: string;
  };
  loc: {
    lat: number;
    long: number;
  };
  severity?: string;
  urgency?: string;
}

export interface XweatherAPIResponse<T> {
  success: boolean;
  error?: {
    code: string;
    description: string;
  };
  response: T[];
}

// ============================================================================
// STATE UTILITIES
// ============================================================================

export const STATE_NAMES: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
};

export const STATE_ABBREVS: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([abbrev, name]) => [name, abbrev])
);

export function getStateName(abbrev: string): string {
  return STATE_NAMES[abbrev.toUpperCase()] || abbrev;
}

export function getStateAbbrev(name: string): string {
  return STATE_ABBREVS[name] || name.substring(0, 2).toUpperCase();
}
