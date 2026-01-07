/**
 * Canonical Risk Factor and Score types
 * Used consistently across City, Region, and National risk scoring
 *
 * THE SINGLE SOURCE OF TRUTH for risk explainability
 */

// ============================================================================
// Canonical Factor Type
// ============================================================================

export type RiskFactorCategory =
  | 'snow'
  | 'rain'
  | 'wind'
  | 'cold'
  | 'heat'
  | 'ice'
  | 'travel'
  | 'severe'
  | 'overlay'
  | 'synergy'
  | 'distribution';

export interface RiskFactor {
  id: string;                     // Stable key e.g. "snow_amount", "spc_overlay"
  label: string;                  // Human readable e.g. "Snow Accumulation"
  category: RiskFactorCategory;   // Hazard category
  observed: string;               // Formatted observed value e.g. 'p90 3.2" (8/25 cities >= 1")'
  points: number;                 // Positive or zero, 2 decimals
  notes: string;                  // Short explanation
  dayIndex: number;               // 0..6 (0 = day 1)
  scope: 'city' | 'region' | 'national';
  meta?: Record<string, any>;     // Thresholds hit, counts, etc.
}

// ============================================================================
// Canonical Score Result
// ============================================================================

export interface RiskScoreResult {
  score_raw: number;              // 2 decimals internal
  score_display: number;          // city/region 1 decimal, national 2 decimals
  level: RiskLevel;               // Risk level label
  factors: RiskFactor[];          // ALL contributions used to compute score
  top_drivers: RiskFactor[];      // Derived from factors sorted by points desc (top 4)
  summary: string;                // Derived from top_drivers + key obs (no hallucinations)
}

// ============================================================================
// Risk Level Type
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert numeric score to RiskLevel
 */
export function scoreToLevel(score: number): RiskLevel {
  if (score >= 9.5) return 'extreme';
  if (score >= 8.5) return 'severe';
  if (score >= 7.5) return 'major';
  if (score >= 6.5) return 'significant';
  if (score >= 5.5) return 'high';
  if (score >= 4.5) return 'elevated';
  if (score >= 3.5) return 'active';
  if (score >= 2.5) return 'marginal';
  if (score >= 1.5) return 'quiet';
  return 'very-quiet';
}

/**
 * Get display label for a risk level
 */
export function levelToLabel(level: RiskLevel): string {
  const labels: Record<RiskLevel, string> = {
    'very-quiet': 'VERY QUIET',
    'quiet': 'QUIET',
    'marginal': 'MARGINAL',
    'active': 'ACTIVE',
    'elevated': 'ELEVATED',
    'high': 'HIGH',
    'significant': 'SIGNIFICANT',
    'major': 'MAJOR',
    'severe': 'SEVERE',
    'extreme': 'EXTREME',
  };
  return labels[level];
}

/**
 * Derive top_drivers from all factors
 * Returns top 4 factors with points >= 0.2, sorted by points descending
 */
export function deriveTopDrivers(factors: RiskFactor[]): RiskFactor[] {
  return factors
    .filter(f => f.points >= 0.2)
    .sort((a, b) => b.points - a.points)
    .slice(0, 4);
}

/**
 * Round to specified decimal places
 */
export function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Clamp value to range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate percentile from array
 */
export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  if (arr.length === 1) return arr[0];

  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower];

  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

// ============================================================================
// SPC/ERO Constants
// ============================================================================

export const SPC_POINTS: Record<string, number> = {
  'TSTM': 0.3,   // General thunderstorm risk
  'MRGL': 1.2,
  'SLGT': 2.0,
  'ENH': 4.0,
  'MDT': 6.0,
  'HIGH': 8.0,
};

export const ERO_POINTS: Record<string, number> = {
  'MRGL': 0.4,
  'SLGT': 1.2,
  'MDT': 2.0,
  'HIGH': 4.5,
};

// WSSI (Winter Storm Severity Index) points mapping
// Cap: max 6.0 points - sized to materially move score without dominating extreme SPC events
export const WSSI_POINTS: Record<string, number> = {
  'NONE': 0.0,
  'WINTER WEATHER AREA': 0.6,
  'MINOR': 1.4,
  'MODERATE': 2.6,
  'MAJOR': 4.0,
  'EXTREME': 5.5,
};

export const SPC_ORDER: Record<string, number> = {
  'TSTM': 0, 'MRGL': 1, 'SLGT': 2, 'ENH': 3, 'MDT': 4, 'HIGH': 5
};

export const ERO_ORDER: Record<string, number> = {
  'MRGL': 1, 'SLGT': 2, 'MDT': 3, 'HIGH': 4
};

export const WSSI_ORDER: Record<string, number> = {
  'NONE': 0,
  'WINTER WEATHER AREA': 1,
  'MINOR': 2,
  'MODERATE': 3,
  'MAJOR': 4,
  'EXTREME': 5,
};

// ============================================================================
// SPC Day 4-8 Constants
// ============================================================================

// Day 4-8 uses DN values (15 or 30) representing probability percentages
// DN 15 = 15% probability of severe within 25 mi -> SLGT-equivalent
// DN 30 = 30%+ probability of severe within 25 mi -> ENH-equivalent
export const SPC_DAY48_DN_TO_CATEGORY: Record<number, string> = {
  15: 'SLGT',
  30: 'ENH',
};

// Points for Day 4-8 probabilistic outlooks
// Higher than Day 1-3 due to extended forecast uncertainty premium
export const SPC_DAY48_POINTS: Record<string, number> = {
  'SLGT': 3.5,   // 15% probability (D4-8 Slight)
  'ENH': 5.5,    // 30% probability (D4-8 Enhanced)
  'NONE': 0.0,
};

// Order for sorting Day 4-8 categories
export const SPC_DAY48_ORDER: Record<string, number> = {
  'NONE': 0,
  'SLGT': 1,
  'ENH': 2,
};

// ============================================================================
// Ice Accumulation (NBM FRAM) Points
// ============================================================================

// Points for NBM ice accumulation (Total Ice Accretion / FRAM)
// Ice is extremely hazardous - even small amounts cause major impacts
// These are BASE points - regions with less ice infrastructure get multipliers
export const ICE_POINTS_THRESHOLDS = {
  // Trace ice (< 0.1"): slick roads, minor travel impacts
  trace: { max: 0.1, points: 1.5 },
  // Light ice (0.1-0.25"): hazardous travel, power line stress
  light: { max: 0.25, points: 2.8 },
  // Moderate ice (0.25-0.5"): significant power outages, tree damage
  moderate: { max: 0.5, points: 5.2 },
  // Heavy ice (0.5-1.0"): major damage, widespread outages
  heavy: { max: 1.0, points: 8.0 },
  // Extreme ice (>1.0"): catastrophic, infrastructure collapse
  extreme: { min: 1.0, points: 10.0 },
};

// Regional multipliers for ice - southern regions less prepared for ice
// Applied to ice points based on region
export const ICE_REGION_MULTIPLIERS: Record<string, number> = {
  'southeast': 1.4,        // Much less ice infrastructure
  'southern_plains': 1.4,  // Much less ice infrastructure
  'southwest': 1.3,        // Rare ice events
  'northeast': 1.15,       // More prepared but still impactful
  'midwest': 1.0,          // Baseline - most prepared
  'northern_plains': 1.0,  // Baseline - most prepared
  'northwest': 1.1,        // Moderate preparation
};

// ============================================================================
// Day Damping for Extended Forecasts
// ============================================================================

export const DAY_DAMPING: Record<number, number> = {
  1: 1.0,
  2: 1.0,
  3: 1.0,
  4: 0.95,
  5: 0.90,
  6: 0.85,
  7: 0.80,
};

/**
 * Apply day damping to a score
 * Only dampens scores > 1.0 for days 4-7
 */
export function applyDayDamping(score: number, dayIndex: number): number {
  const damping = DAY_DAMPING[Math.min(7, Math.max(1, dayIndex))] || 1.0;
  if (score > 1 && damping < 1) {
    return 1 + (score - 1) * damping;
  }
  return score;
}
