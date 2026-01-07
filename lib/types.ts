// ============================================================================
// Region Types
// ============================================================================

export type RegionId =
  | 'northeast'
  | 'southeast'
  | 'midwest'
  | 'southern_plains'
  | 'northern_plains'
  | 'northwest'
  | 'southwest';

export interface RegionDefinition {
  id: RegionId;
  name: string;
  shortName: string;
  states: string[];
  center: { lat: number; lon: number };
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

// ============================================================================
// Risk Types
// ============================================================================

export type RiskLevel =
  | 'very-quiet'
  | 'quiet'
  | 'marginal'
  | 'active'
  | 'elevated'
  | 'high'
  | 'significant'
  | 'major'
  | 'severe'
  | 'extreme';

export interface RiskBreakdownItem {
  hazard?: string;
  category: string;
  score?: number;
  observed?: string;
  notes?: string;
  contribution?: number;
  details?: string;
}

export interface RiskDriver {
  hazard: string;
  score: number;
  observation?: string;
  // Legacy fields for backward compatibility
  rawValue?: number;
  unit?: string;
  description?: string;
}

export interface RiskExplainPayload {
  summary_text: string;
  top_drivers: RiskDriver[];
  breakdown: RiskBreakdownItem[];
  score: number;
  level: RiskLevel;
}

export interface DayExplainPayload {
  summary_text: string;
  top_drivers: RiskDriver[];
  breakdown: RiskBreakdownItem[];
}

// ============================================================================
// Hazard Types
// ============================================================================

export interface HazardInfo {
  hazard: string;
  score: number;
  rawValue: number;
  unit: string;
  threshold?: number;
}

// ============================================================================
// Forecast Types
// ============================================================================

export interface DayRisk {
  date: string;
  score: number;
  level: RiskLevel;
  hazards: HazardInfo[];
  headline?: string;
}

export interface RegionRisk {
  overall: number;
  level: RiskLevel;
  headline: string;
  days: DayRisk[];
}

export interface RegionSummary {
  tempRange: { min: number; max: number };
  totalSnow: number;
  totalPrecip: number;
  maxWindGust: number;
}

export interface RegionForecast {
  region: {
    id: RegionId;
    name: string;
  };
  risk: RegionRisk;
  summary: RegionSummary;
}

export interface NationalForecast {
  overallRisk: number;
  level: RiskLevel;
  activeRegions: RegionId[];
  daily?: RegionDailyData[];
  explain?: RiskExplainPayload;
}

export interface ForecastMeta {
  fetchedAt: string;
  models?: string[];
}

export interface ForecastResponse {
  national: NationalForecast;
  regions: RegionForecast[];
  meta: ForecastMeta;
}

// ============================================================================
// Narrative Types
// ============================================================================

export interface NationalNarrative {
  headline: string;
  overview: string;
  highlights?: string[];
}

export interface DayByDayNarrative {
  date: string;
  narrative: string;
}

export interface RegionNarrative {
  regionId: RegionId;
  headline: string;
  summary: string;
  highlights?: string[];
  dayByDay?: DayByDayNarrative[];
}

export interface NarrativeMeta {
  generatedAt: string;
  model?: string;
}

export interface NarrativeResponse {
  national: NationalNarrative;
  regional: RegionNarrative[];
  meta: NarrativeMeta;
}

// ============================================================================
// City Types
// ============================================================================

export interface CityDefinition {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  regionId: RegionId;
  population?: number;
}

export type SnowConfidence = 'high' | 'medium' | 'low';

export interface SnowRange {
  min: number;
  max: number;
  median: number;
  spread: number;
}

export interface ExpectedConditions {
  primary: string;
  secondary?: string;
  icon?: string;
}

export interface CityDailySummary {
  date_local: string;
  tmax: number;
  tmin: number;
  snow_total: number;
  rain_total: number;
  wind_gust_max: number;
  snow_range?: SnowRange;
  confidence_snow?: SnowConfidence;
  conditions?: ExpectedConditions;
}

export interface ScoreBreakdown {
  spcPoints: number;
  wpcPoints: number;
  wssiPoints: number;
  weatherPoints: number;
  total: number;
}

export interface OverlayMetadata {
  // Day 1-3 SPC
  spc_category: string;
  spc_points: number;
  spc_source_url: string;
  spc_valid_time: string | null;
  spc_status: 'ok' | 'no_features' | 'fetch_failed' | 'outside_coverage';
  // Day 4-8 SPC probabilistic outlook
  spc_day48_category?: string;
  spc_day48_dn?: number | null;
  spc_day48_points?: number;
  spc_day48_source_url?: string;
  spc_day48_valid_time?: string | null;
  spc_day48_status?: 'ok' | 'no_features' | 'fetch_failed' | 'outside_coverage' | 'invalid_day';
  // ERO
  ero_category: string;
  ero_points: number;
  ero_source_url: string;
  ero_valid_time: string | null;
  ero_status: 'ok' | 'no_features' | 'fetch_failed' | 'outside_coverage';
  // WSSI
  wssi_category: string;
  wssi_points: number;
  wssi_source_url: string;
  wssi_valid_time: string | null;
  wssi_issue_time: string | null;
  wssi_status: 'ok' | 'no_intersection' | 'fetch_failed' | 'outside_coverage';
}

export interface CityDailyRisk {
  date: string;
  score_raw: number;
  score_display: number;
  level: RiskLevel;
  explain?: DayExplainPayload;
  score_breakdown?: ScoreBreakdown;
  overlay?: OverlayMetadata;
}

export interface CityHourlyData {
  time: string;
  temperature: number;
  precipitation: number;
  windGust: number;
  snowfall?: number;
}

export interface CityMetrics {
  tempMax48h: number;
  tempMin48h: number;
  snow24h: number;
  snow48h: number;
  rain24h: number;
  rain48h: number;
  maxGust24h: number;
  maxGust48h: number;
  confidenceSnow?: SnowConfidence;
}

export interface CityMetricsSummary {
  id: string;
  cityId: string;
  name: string;
  state: string;
  regionId: RegionId;
  lat: number;
  lon: number;
  available: boolean;
  tempMax48h: number;
  tempMin48h: number;
  snow24h: number;
  rain24h: number;
  maxGust48h: number;
  riskScore?: number;
  dailySummary?: CityDailySummary[];
  dailyRisks?: CityDailyRisk[];
  days: Array<{ risk: number; condition: string }>;
}

export interface CityDetailForecast {
  city: CityDefinition;
  regionId: RegionId;
  metrics: CityMetrics;
  hourly: CityHourlyData[];
  dailySummary: CityDailySummary[];
  dailyRisks: CityDailyRisk[];
  riskTrend: 'rising' | 'falling' | 'steady';
  fetchedAt: string;
}

export interface CityNarrative {
  cityId: string;
  headline: string;
  summary: string;
  confidence: string;
  updatedUtc: string;
  disclaimer?: string;
}

// ============================================================================
// Region Daily Data (from /api/regions)
// ============================================================================

export interface RegionDailyData {
  date: string;
  score: number;
  score_display: number;
  level: RiskLevel;
  explain?: DayExplainPayload;
  forecast_text?: string;
  // Debug info for SPC overlays (optional, only included when available)
  spc_debug?: {
    max_spc_category?: string;
    max_spc_city?: string;
    avg_spc_points?: number;
    city_breakdown?: Array<{ cityId: string; cityName: string; category: string }>;
  };
}

export interface RegionExplainPayload {
  summary_text: string;
  top_drivers: RiskDriver[];
  breakdown: RiskBreakdownItem[];
}

// ============================================================================
// Overlay Types (SPC, WPC ERO)
// ============================================================================

export interface SPCOutlookLevel {
  level: number;
  category: string;
  probability?: number;
}

export interface SPCDayOutlook {
  categorical?: SPCOutlookLevel;
  tornado?: SPCOutlookLevel;
  wind?: SPCOutlookLevel;
  hail?: SPCOutlookLevel;
}

export interface SPCOutlook {
  day1?: SPCDayOutlook;
  day2?: SPCDayOutlook;
  day3?: SPCDayOutlook;
  validTime?: string;
}

export interface EROLevel {
  level: number;
  category: string;
}

export interface EROOutlook {
  day1?: EROLevel;
  day2?: EROLevel;
  day3?: EROLevel;
  validTime?: string;
}

export interface LocationOverlay {
  spc?: SPCOutlook;
  ero?: EROOutlook;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface RegionCitiesResponse {
  regionId: RegionId;
  riskScore: number;
  riskLevel: RiskLevel;
  cities: CityMetricsSummary[];
  explain?: RegionExplainPayload;
  daily?: RegionDailyData[];
}

export interface RegionsAPIResponse {
  regions: RegionCitiesResponse[];
  national: NationalForecast & {
    explain?: RiskExplainPayload;
    daily?: RegionDailyData[];
  };
  fetchedAt: string;
}

// ============================================================================
// City Forecast Types (for drawer/detail view)
// ============================================================================

export interface CityDayForecast {
  risk: number;
  tempHigh: number;
  tempLow: number;
  precipTotal: number;
  precipChance: number;
  windGust: number;
  condition: string;
  risks?: {
    snow?: number;
    rain?: number;
    wind?: number;
    cold?: number;
    heat?: number;
  };
}

export interface CityForecast {
  city: CityDefinition;
  days: CityDayForecast[];
  hourly?: {
    temperature: number[];
    precipitation: number[];
    windGusts: number[];
  };
}

// ============================================================================
// Region Risk Data (for map and components)
// ============================================================================

export interface RegionDayRisk {
  risk: number;
  conditions: string;
  explain?: DayExplainPayload;
}

export interface RegionRiskData {
  day1: RegionDayRisk;
  day2: RegionDayRisk;
  day3: RegionDayRisk;
  day4?: RegionDayRisk;
  day5?: RegionDayRisk;
  day6?: RegionDayRisk;
  day7?: RegionDayRisk;
}
