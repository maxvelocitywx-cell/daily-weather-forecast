import { RiskLevel } from './types';

/**
 * Convert a numeric risk score (1-10) to a RiskLevel
 */
export function getRiskLevel(score: number): RiskLevel {
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
 * Get a human-readable label for a risk level
 */
export function getRiskLabel(score: number): string {
  if (score >= 9.5) return 'EXTREME';
  if (score >= 8.5) return 'SEVERE';
  if (score >= 7.5) return 'MAJOR';
  if (score >= 6.5) return 'SIGNIFICANT';
  if (score >= 5.5) return 'HIGH';
  if (score >= 4.5) return 'ELEVATED';
  if (score >= 3.5) return 'ACTIVE';
  if (score >= 2.5) return 'MARGINAL';
  if (score >= 1.5) return 'QUIET';
  return 'VERY QUIET';
}

/**
 * Get Tailwind color classes for a risk score
 */
export function getRiskColorClass(score: number): string {
  if (score >= 9.5) return 'text-gray-100 bg-gray-900';
  if (score >= 8.5) return 'text-white bg-purple-700';
  if (score >= 7.5) return 'text-white bg-red-800';
  if (score >= 6.5) return 'text-white bg-red-600';
  if (score >= 5.5) return 'text-white bg-red-500';
  if (score >= 4.5) return 'text-white bg-red-400';
  if (score >= 3.5) return 'text-white bg-orange-400';
  if (score >= 2.5) return 'text-gray-900 bg-yellow-400';
  if (score >= 1.5) return 'text-white bg-lime-500';
  return 'text-white bg-emerald-500';
}

/**
 * Get just the text color for inline use
 */
export function getRiskTextColor(score: number): string {
  if (score >= 6) return 'text-red-400';
  if (score >= 4) return 'text-orange-400';
  if (score >= 3) return 'text-yellow-400';
  return 'text-mv-text-muted';
}

/**
 * Calculate risk score from weather metrics
 * @param metrics - Weather measurements
 * @param dayIndex - Day index (1-7), used for long-range damping on days 6-7
 */
export interface WeatherMetrics {
  snowfall?: number;      // inches
  rainfall?: number;      // inches
  windGust?: number;      // mph
  tempMin?: number;       // °F
  tempMax?: number;       // °F
  iceAccum?: number;      // inches
  visibility?: number;    // miles
}

// Damping factors for extended forecasts (less confidence in days 6-7)
const DAY_DAMPING: Record<number, number> = {
  1: 1.0,
  2: 1.0,
  3: 1.0,
  4: 0.95,
  5: 0.9,
  6: 0.8,  // Modest damping for day 6
  7: 0.7,  // More damping for day 7
};

export function calculateRiskScore(metrics: WeatherMetrics, dayIndex: number = 1): number {
  let score = 1.0;
  const damping = DAY_DAMPING[Math.min(7, Math.max(1, dayIndex))] || 1.0;

  // Snow contribution (major driver, but tiny amounts don't add much risk)
  if (metrics.snowfall) {
    if (metrics.snowfall >= 24) score = Math.max(score, 9.0);
    else if (metrics.snowfall >= 18) score = Math.max(score, 8.0);
    else if (metrics.snowfall >= 12) score = Math.max(score, 7.0);
    else if (metrics.snowfall >= 8) score = Math.max(score, 6.0);
    else if (metrics.snowfall >= 6) score = Math.max(score, 5.0);
    else if (metrics.snowfall >= 4) score = Math.max(score, 4.0);
    else if (metrics.snowfall >= 2) score = Math.max(score, 3.0);
    else if (metrics.snowfall >= 1) score = Math.max(score, 2.0);
    else if (metrics.snowfall >= 0.5) score = Math.max(score, 1.5);
    // Below 0.5" is just a dusting - minimal risk bump
  }

  // Rain contribution (tiny amounts don't add much risk)
  if (metrics.rainfall) {
    if (metrics.rainfall >= 4) score = Math.max(score, 7.0);
    else if (metrics.rainfall >= 2) score = Math.max(score, 5.0);
    else if (metrics.rainfall >= 1) score = Math.max(score, 4.0);
    else if (metrics.rainfall >= 0.5) score = Math.max(score, 3.0);
    else if (metrics.rainfall >= 0.25) score = Math.max(score, 2.0);
    else if (metrics.rainfall >= 0.1) score = Math.max(score, 1.5);
    // Below 0.1" is just trace precip - no meaningful risk bump
  }

  // Wind contribution
  if (metrics.windGust) {
    if (metrics.windGust >= 80) score = Math.max(score, 8.0);
    else if (metrics.windGust >= 60) score = Math.max(score, 6.0);
    else if (metrics.windGust >= 50) score = Math.max(score, 5.0);
    else if (metrics.windGust >= 40) score = Math.max(score, 4.0);
    else if (metrics.windGust >= 30) score = Math.max(score, 2.5);
  }

  // Ice contribution (very impactful)
  if (metrics.iceAccum) {
    if (metrics.iceAccum >= 1) score = Math.max(score, 9.0);
    else if (metrics.iceAccum >= 0.5) score = Math.max(score, 7.0);
    else if (metrics.iceAccum >= 0.25) score = Math.max(score, 5.0);
    else if (metrics.iceAccum >= 0.1) score = Math.max(score, 4.0);
  }

  // Extreme cold
  if (metrics.tempMin !== undefined) {
    if (metrics.tempMin <= -20) score = Math.max(score, 6.0);
    else if (metrics.tempMin <= -10) score = Math.max(score, 4.0);
    else if (metrics.tempMin <= 0) score = Math.max(score, 3.0);
  }

  // Extreme heat
  if (metrics.tempMax !== undefined) {
    if (metrics.tempMax >= 115) score = Math.max(score, 8.0);
    else if (metrics.tempMax >= 105) score = Math.max(score, 5.0);
    else if (metrics.tempMax >= 100) score = Math.max(score, 4.0);
  }

  // Apply damping for extended forecasts (days 6-7)
  // Only dampen scores above baseline - don't reduce calm weather scores
  if (score > 1 && damping < 1) {
    score = 1 + (score - 1) * damping;
  }

  return Math.min(10, Math.max(1, score));
}
