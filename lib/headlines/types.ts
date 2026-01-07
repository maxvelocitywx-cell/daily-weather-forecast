/**
 * Headlines System Types
 *
 * Types for the weather headlines generation and storage system.
 * Includes EventFact schema for real-time observation/report data.
 */

// ============================================================================
// EVENT FACT TYPES (Real-time observations & reports)
// ============================================================================

export type EventFactType =
  | 'wind_gust'
  | 'hail'
  | 'tornado_report'
  | 'tornado_rating'
  | 'flash_flood'
  | 'flood'
  | 'snowfall'
  | 'ice_accumulation'
  | 'temperature_extreme'
  | 'lightning'
  | 'damage'
  | 'marine_hazard'
  | 'other';

export type EventFactConfidence =
  | 'measured'   // From official station observations
  | 'reported'   // From LSR/spotter reports
  | 'surveyed'   // From official damage surveys (EF ratings)
  | 'estimated'; // Radar-estimated or model-derived

export interface EventFact {
  id: string;
  type: EventFactType;
  magnitude: number | string | null; // number for wind/hail, string for EF ratings
  units: string | null;              // "mph", "inches", "EF", null for reports
  location_name: string;
  lat: number;
  lon: number;
  county_fips?: string;
  state: string;
  timestamp_utc: string;             // ISO 8601
  source_name: string;
  source_url: string;
  confidence: EventFactConfidence;
  remarks?: string;                  // Additional context from report
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

// Updated: confidence now reflects the data source type
export type HeadlineConfidence = 'measured' | 'reported' | 'surveyed' | 'high' | 'medium' | 'low';

export interface Headline {
  headline: string;                  // max 90 chars
  topic: HeadlineTopic;
  regions: string[];
  confidence: HeadlineConfidence;
  source_name: string;
  source_url: string;
  timestamp?: string;                // ISO 8601, for real-time events
  lat?: number;                      // For map dot display
  lon?: number;
}

export interface HeadlinesRun {
  id: string;
  timestamp: string;                 // ISO 8601
  headlines: Headline[];
  facts_summary?: string;            // Brief summary of data sources used
}

// ============================================================================
// ALERT/OUTLOOK FACT TYPES (from existing sources)
// ============================================================================

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
  day: number;
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
  day: number;
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

// ============================================================================
// FACTS BUNDLE (combined for headline generation)
// ============================================================================

export interface FactsBundle {
  generated_at: string;
  // Real-time events
  event_facts: EventFact[];
  // Alerts and outlooks
  alerts: AlertFact[];
  spc_outlooks: SPCFact[];
  spc_mds: SPCMDFact[];
  ero_outlooks: EROFact[];
  tropical: TropicalFact[];
  // Metadata
  total_active_alerts: number;
  total_event_facts: number;
  top_events: string[];
}

// ============================================================================
// OPENAI RESPONSE SCHEMA
// ============================================================================

export const HeadlinesSchema = {
  type: 'object',
  properties: {
    headlines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          headline: {
            type: 'string',
            description: 'Short headline, max 90 characters',
          },
          topic: {
            type: 'string',
            enum: ['severe', 'winter', 'flood', 'tropical', 'heat', 'fire', 'aviation', 'marine', 'general'],
          },
          regions: {
            type: 'array',
            items: { type: 'string' },
            description: 'US regions or states affected',
          },
          confidence: {
            type: 'string',
            enum: ['measured', 'reported', 'surveyed', 'high', 'medium', 'low'],
            description: 'measured=from official obs, reported=from LSR/spotters, surveyed=official damage survey, high/medium/low=alert/outlook based',
          },
          source_name: {
            type: 'string',
            description: 'Name of the data source',
          },
          source_url: {
            type: 'string',
            description: 'URL to the source product',
          },
          timestamp: {
            type: 'string',
            description: 'ISO 8601 timestamp of the event (for real-time reports)',
          },
          lat: {
            type: 'number',
            description: 'Latitude of the event location (for map display)',
          },
          lon: {
            type: 'number',
            description: 'Longitude of the event location (for map display)',
          },
        },
        required: ['headline', 'topic', 'regions', 'confidence', 'source_name', 'source_url'],
        additionalProperties: false,
      },
      minItems: 10,
      maxItems: 10,
    },
  },
  required: ['headlines'],
  additionalProperties: false,
} as const;
