/**
 * Unified Risk Scoring Module
 *
 * Exports all canonical risk scoring functions and types.
 * This is the single entry point for all risk calculations.
 */

// Types from riskTypes
export type {
  RiskFactor,
  RiskScoreResult,
  RiskLevel,
  RiskFactorCategory,
} from './riskTypes';

export {
  scoreToLevel,
  levelToLabel,
  deriveTopDrivers,
  round,
  clamp,
  percentile,
  applyDayDamping,
  SPC_POINTS,
  ERO_POINTS,
  SPC_ORDER,
  ERO_ORDER,
  DAY_DAMPING,
  ICE_POINTS_THRESHOLDS,
  ICE_REGION_MULTIPLIERS,
} from './riskTypes';

// City Scoring
export type {
  CityDayInput,
  CityOverlays,
} from './computeCityRisk';

export {
  computeCityRisk,
} from './computeCityRisk';

// Region Scoring
export type {
  CityRiskInput,
  RegionWeatherMetrics,
} from './computeRegionRisk';

export {
  computeRegionRisk,
  computeRegionMetrics,
} from './computeRegionRisk';

// National Scoring
export type {
  RegionRiskInput,
} from './computeNationalRisk';

export {
  computeNationalRisk,
  extractRegionRiskInput,
} from './computeNationalRisk';
