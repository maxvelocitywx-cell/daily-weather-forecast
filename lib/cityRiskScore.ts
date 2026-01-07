/**
 * City-level risk scoring system with comprehensive explainability
 * Calculates daily risk scores (0-10) for each city based on 15+ weather factors
 */

import { RiskLevel, RiskDriver, RiskBreakdownItem } from './types';

// ============================================================================
// Types
// ============================================================================

export interface CityDayMetrics {
  tmax_f: number;
  tmin_f: number;
  wind_gust_mph: number;
  rain_in: number;
  snow_in: number;
  weatherCode?: number;
  // Hourly data for intensity calculations (optional)
  hourlyPrecip?: number[];      // hourly precip in inches
  hourlySnow?: number[];        // hourly snowfall in inches
  hourlyTemp?: number[];        // hourly temps in F
  hourlyWindGust?: number[];    // hourly wind gusts in mph
  // Overlay modifiers (Days 1-3 only)
  spcCategory?: 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';
  eroCategory?: 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';
}

export interface CityRiskFlags {
  snowPresent: boolean;     // >= 0.2"
  rainPresent: boolean;     // >= 0.05"
  heavySnow: boolean;       // >= 4"
  heavyRain: boolean;       // >= 1"
  windy: boolean;           // >= 30 mph
  veryWindy: boolean;       // >= 50 mph
  extremeCold: boolean;     // <= 0°F
  veryCold: boolean;        // <= 10°F
  extremeHeat: boolean;     // >= 100°F
  veryHot: boolean;         // >= 95°F
  wintryMix: boolean;       // snow + rain both present
  severeRisk: boolean;      // SPC overlay present
  floodRisk: boolean;       // ERO overlay present
  blowingSnow: boolean;     // snow + high winds
  flashFreeze: boolean;     // rapid temp drop proxy
}

export interface FactorResult {
  points: number;
  observed: string;
  notes: string;
  category: string;
}

export interface CityRiskResult {
  score_raw: number;        // 0.00-10.00 with 2 decimals
  score_display: number;    // 0.0-10.0 with 1 decimal
  level: RiskLevel;
  summary_text: string;     // 1-2 sentence explanation
  top_drivers: RiskDriver[];
  breakdown: RiskBreakdownItem[];
  flags: CityRiskFlags;
  factorCount: number;      // Number of active factors
}

// ============================================================================
// Scoring constants
// ============================================================================

// SPC Convective Outlook modifiers (Days 1-3 only)
const SPC_MODIFIERS: Record<string, number> = {
  'MRGL': 1.2,
  'SLGT': 2.0,
  'ENH': 4.0,
  'MDT': 6.0,
  'HIGH': 8.0,
};

// WPC ERO modifiers (Days 1-3 only)
const ERO_MODIFIERS: Record<string, number> = {
  'MRGL': 0.4,
  'SLGT': 1.2,
  'MDT': 2.0,
  'HIGH': 4.5,
};

// Day damping for extended forecasts
const DAY_DAMPING: Record<number, number> = {
  1: 1.0,
  2: 1.0,
  3: 1.0,
  4: 0.95,
  5: 0.90,
  6: 0.85,
  7: 0.80,
};

// ============================================================================
// PRECIP/WINTER FACTORS (6-8 factors)
// ============================================================================

/**
 * Factor 1: Snow Amount (daily total, continuous)
 * Max points: 4.0
 */
function scoreSnowAmount(snowIn: number): FactorResult {
  let points = 0;
  let notes = 'None';

  if (snowIn <= 0) {
    points = 0;
    notes = 'None';
  } else if (snowIn < 0.1) {
    points = 0.1;
    notes = 'Trace';
  } else if (snowIn < 0.5) {
    points = 0.2 + (snowIn - 0.1) * 0.75;
    notes = 'Dusting';
  } else if (snowIn < 1) {
    points = 0.5 + (snowIn - 0.5) * 1.0;
    notes = 'Light coating';
  } else if (snowIn < 2) {
    points = 1.0 + (snowIn - 1) * 0.6;
    notes = `${snowIn.toFixed(1)}" accumulating`;
  } else if (snowIn < 4) {
    points = 1.6 + (snowIn - 2) * 0.45;
    notes = `${snowIn.toFixed(1)}" moderate`;
  } else if (snowIn < 6) {
    points = 2.5 + (snowIn - 4) * 0.4;
    notes = `${snowIn.toFixed(1)}" heavy`;
  } else if (snowIn < 12) {
    points = 3.3 + (snowIn - 6) * 0.1;
    notes = `${snowIn.toFixed(1)}" major`;
  } else {
    points = 4.0;
    notes = `${snowIn.toFixed(1)}" extreme`;
  }

  return {
    points: Math.min(4.0, points),
    observed: `${snowIn.toFixed(2)}"`,
    notes,
    category: 'Snow Amount',
  };
}

/**
 * Factor 2: Snow Rate Proxy (intensity)
 * Uses max hourly snow if available, else estimates from daily total
 * Max points: 1.5
 */
function scoreSnowRate(snowIn: number, hourlySnow?: number[]): FactorResult {
  let maxHourlySnow = 0;

  if (hourlySnow && hourlySnow.length > 0) {
    maxHourlySnow = Math.max(...hourlySnow);
  } else {
    // Estimate: assume snow falls over 6-12 hours
    maxHourlySnow = snowIn > 0 ? snowIn / 8 : 0;
  }

  let points = 0;
  let notes = 'Light or none';

  if (maxHourlySnow >= 2) {
    points = 1.5;
    notes = 'Extreme rate (>2"/hr)';
  } else if (maxHourlySnow >= 1) {
    points = 1.0 + (maxHourlySnow - 1) * 0.5;
    notes = 'Heavy rate (1-2"/hr)';
  } else if (maxHourlySnow >= 0.5) {
    points = 0.5 + (maxHourlySnow - 0.5) * 1.0;
    notes = 'Moderate rate';
  } else if (maxHourlySnow >= 0.2) {
    points = 0.2 + (maxHourlySnow - 0.2) * 1.0;
    notes = 'Light-moderate rate';
  } else if (maxHourlySnow > 0) {
    points = maxHourlySnow;
    notes = 'Light rate';
  }

  return {
    points: Math.min(1.5, points),
    observed: `${maxHourlySnow.toFixed(2)}"/hr max`,
    notes,
    category: 'Snow Rate',
  };
}

/**
 * Factor 3: Snow Duration/Persistence Proxy
 * Hours with measurable snow
 * Max points: 1.0
 */
function scoreSnowDuration(snowIn: number, hourlySnow?: number[]): FactorResult {
  let snowHours = 0;

  if (hourlySnow && hourlySnow.length > 0) {
    snowHours = hourlySnow.filter(s => s >= 0.01).length;
  } else {
    // Estimate based on total
    if (snowIn >= 6) snowHours = 12;
    else if (snowIn >= 3) snowHours = 8;
    else if (snowIn >= 1) snowHours = 5;
    else if (snowIn >= 0.5) snowHours = 3;
    else if (snowIn > 0) snowHours = 1;
  }

  let points = 0;
  let notes = 'Brief or none';

  if (snowHours >= 12) {
    points = 1.0;
    notes = 'All-day snow (12+ hrs)';
  } else if (snowHours >= 8) {
    points = 0.7;
    notes = 'Extended snow (8-12 hrs)';
  } else if (snowHours >= 5) {
    points = 0.4;
    notes = 'Moderate duration (5-8 hrs)';
  } else if (snowHours >= 2) {
    points = 0.2;
    notes = 'Brief snow (2-5 hrs)';
  } else if (snowHours >= 1) {
    points = 0.1;
    notes = 'Very brief (<2 hrs)';
  }

  return {
    points: Math.min(1.0, points),
    observed: `${snowHours} hrs`,
    notes,
    category: 'Snow Duration',
  };
}

/**
 * Factor 4: Rain Amount (daily total, continuous)
 * Max points: 3.0
 */
function scoreRainAmount(rainIn: number): FactorResult {
  let points = 0;
  let notes = 'None';

  if (rainIn <= 0) {
    points = 0;
    notes = 'None';
  } else if (rainIn < 0.05) {
    points = 0.05;
    notes = 'Trace';
  } else if (rainIn < 0.1) {
    points = 0.1;
    notes = 'Sprinkles';
  } else if (rainIn < 0.25) {
    points = 0.15 + (rainIn - 0.1) * 0.7;
    notes = 'Light rain';
  } else if (rainIn < 0.5) {
    points = 0.25 + (rainIn - 0.25) * 1.0;
    notes = 'Rain';
  } else if (rainIn < 1) {
    points = 0.5 + (rainIn - 0.5) * 1.0;
    notes = 'Moderate rain';
  } else if (rainIn < 2) {
    points = 1.0 + (rainIn - 1) * 0.8;
    notes = `${rainIn.toFixed(2)}" heavy rain`;
  } else if (rainIn < 4) {
    points = 1.8 + (rainIn - 2) * 0.4;
    notes = `${rainIn.toFixed(2)}" very heavy`;
  } else {
    points = 3.0;
    notes = `${rainIn.toFixed(2)}" extreme rain`;
  }

  return {
    points: Math.min(3.0, points),
    observed: `${rainIn.toFixed(2)}"`,
    notes,
    category: 'Rain Amount',
  };
}

/**
 * Factor 5: Rain Intensity (max hourly rate)
 * Max points: 1.5
 */
function scoreRainIntensity(rainIn: number, hourlyPrecip?: number[]): FactorResult {
  let maxHourlyRain = 0;

  if (hourlyPrecip && hourlyPrecip.length > 0) {
    maxHourlyRain = Math.max(...hourlyPrecip);
  } else {
    // Estimate: assume rain falls over 4-8 hours
    maxHourlyRain = rainIn > 0 ? rainIn / 6 : 0;
  }

  let points = 0;
  let notes = 'Light or none';

  if (maxHourlyRain >= 1.0) {
    points = 1.5;
    notes = 'Extreme rate (>1"/hr)';
  } else if (maxHourlyRain >= 0.5) {
    points = 1.0 + (maxHourlyRain - 0.5) * 1.0;
    notes = 'Heavy rate (0.5-1"/hr)';
  } else if (maxHourlyRain >= 0.25) {
    points = 0.5 + (maxHourlyRain - 0.25) * 2.0;
    notes = 'Moderate rate';
  } else if (maxHourlyRain >= 0.1) {
    points = 0.2 + (maxHourlyRain - 0.1) * 2.0;
    notes = 'Light-moderate rate';
  } else if (maxHourlyRain > 0) {
    points = maxHourlyRain * 2;
    notes = 'Light rate';
  }

  return {
    points: Math.min(1.5, points),
    observed: `${maxHourlyRain.toFixed(2)}"/hr max`,
    notes,
    category: 'Rain Intensity',
  };
}

/**
 * Factor 6: Wintry Mix Proxy
 * Only scored if both snow and rain are present
 * Max points: 0.8
 */
function scoreWintryMix(snowIn: number, rainIn: number, tmin: number, tmax: number): FactorResult {
  // Need both precip types and temps near freezing
  if (snowIn < 0.1 || rainIn < 0.05) {
    return { points: 0, observed: 'N/A', notes: 'No mix', category: 'Wintry Mix' };
  }

  const avgTemp = (tmin + tmax) / 2;
  const nearFreezing = avgTemp >= 28 && avgTemp <= 38;

  if (!nearFreezing) {
    return { points: 0, observed: 'N/A', notes: 'Temps not conducive', category: 'Wintry Mix' };
  }

  const mixIntensity = Math.min(snowIn, rainIn);
  let points = 0;
  let notes = 'Minor mix';

  if (mixIntensity >= 0.5) {
    points = 0.8;
    notes = 'Significant wintry mix';
  } else if (mixIntensity >= 0.25) {
    points = 0.5;
    notes = 'Moderate wintry mix';
  } else {
    points = 0.2;
    notes = 'Light wintry mix';
  }

  return {
    points,
    observed: `Snow ${snowIn.toFixed(1)}" + Rain ${rainIn.toFixed(2)}"`,
    notes,
    category: 'Wintry Mix',
  };
}

/**
 * Factor 7: Ice/Freezing Rain Proxy
 * Based on rain + temps at/below freezing
 * Max points: 2.0 (ice is dangerous)
 */
function scoreIceProxy(rainIn: number, tmin: number, tmax: number, hourlyTemp?: number[]): FactorResult {
  // Need rain and surface temps near/below freezing
  if (rainIn < 0.05) {
    return { points: 0, observed: 'N/A', notes: 'No rain', category: 'Ice/Freezing Rain' };
  }

  // Check for freezing temps
  let freezingHours = 0;
  if (hourlyTemp && hourlyTemp.length > 0) {
    freezingHours = hourlyTemp.filter(t => t <= 32).length;
  } else {
    // Estimate from min/max
    if (tmin <= 32 && tmax <= 34) freezingHours = 12;
    else if (tmin <= 32 && tmax <= 38) freezingHours = 6;
    else if (tmin <= 30) freezingHours = 3;
  }

  if (freezingHours < 2) {
    return { points: 0, observed: 'N/A', notes: 'Temps above freezing', category: 'Ice/Freezing Rain' };
  }

  // Calculate ice potential
  const iceAmount = rainIn * (freezingHours / 12); // Rough proxy
  let points = 0;
  let notes = 'Minor icing possible';

  if (iceAmount >= 0.5 || (rainIn >= 0.5 && freezingHours >= 8)) {
    points = 2.0;
    notes = 'Significant ice accumulation likely';
  } else if (iceAmount >= 0.25 || (rainIn >= 0.25 && freezingHours >= 6)) {
    points = 1.2;
    notes = 'Moderate ice accumulation possible';
  } else if (iceAmount >= 0.1) {
    points = 0.6;
    notes = 'Light ice accumulation possible';
  } else {
    points = 0.3;
    notes = 'Minor icing possible';
  }

  return {
    points: Math.min(2.0, points),
    observed: `${rainIn.toFixed(2)}" rain, ${freezingHours}hrs <= 32°F`,
    notes,
    category: 'Ice/Freezing Rain',
  };
}

// ============================================================================
// WIND/TEMPERATURE FACTORS (4-6 factors)
// ============================================================================

/**
 * Factor 8: Wind Gust Magnitude
 * Max points: 3.0
 */
function scoreWindGust(gustMph: number): FactorResult {
  let points = 0;
  let notes = 'Light';

  if (gustMph < 20) {
    points = 0;
    notes = 'Light';
  } else if (gustMph < 30) {
    points = 0.2 + (gustMph - 20) * 0.03;
    notes = 'Breezy';
  } else if (gustMph < 40) {
    points = 0.5 + (gustMph - 30) * 0.08;
    notes = 'Windy';
  } else if (gustMph < 50) {
    points = 1.3 + (gustMph - 40) * 0.1;
    notes = 'Very windy';
  } else if (gustMph < 60) {
    points = 2.3 + (gustMph - 50) * 0.05;
    notes = 'High winds';
  } else if (gustMph < 75) {
    points = 2.8 + (gustMph - 60) * 0.013;
    notes = 'Damaging winds';
  } else {
    points = 3.0;
    notes = 'Destructive winds';
  }

  return {
    points: Math.min(3.0, points),
    observed: `${Math.round(gustMph)} mph`,
    notes,
    category: 'Wind Gust',
  };
}

/**
 * Factor 9: Wind Duration Proxy
 * Hours with gusts >= 25 mph
 * Max points: 0.8
 */
function scoreWindDuration(gustMph: number, hourlyGusts?: number[]): FactorResult {
  let windyHours = 0;

  if (hourlyGusts && hourlyGusts.length > 0) {
    windyHours = hourlyGusts.filter(g => g >= 25).length;
  } else {
    // Estimate from max gust
    if (gustMph >= 50) windyHours = 8;
    else if (gustMph >= 40) windyHours = 6;
    else if (gustMph >= 30) windyHours = 4;
    else if (gustMph >= 25) windyHours = 2;
  }

  let points = 0;
  let notes = 'Brief or calm';

  if (windyHours >= 12) {
    points = 0.8;
    notes = 'Sustained all day';
  } else if (windyHours >= 8) {
    points = 0.6;
    notes = 'Extended wind (8-12 hrs)';
  } else if (windyHours >= 4) {
    points = 0.3;
    notes = 'Moderate duration';
  } else if (windyHours >= 2) {
    points = 0.15;
    notes = 'Brief gusty period';
  }

  return {
    points: Math.min(0.8, points),
    observed: `${windyHours} hrs >= 25 mph`,
    notes,
    category: 'Wind Duration',
  };
}

/**
 * Factor 10: Cold Intensity (tmin)
 * CAPPED to prevent cold from dominating
 * Max points: 1.8
 */
function scoreColdIntensity(tminF: number): FactorResult {
  let points = 0;
  let notes = 'Mild';

  if (tminF > 32) {
    points = 0;
    notes = 'Above freezing';
  } else if (tminF > 25) {
    points = 0.1 + (32 - tminF) * 0.02;
    notes = 'Cold';
  } else if (tminF > 15) {
    points = 0.25 + (25 - tminF) * 0.04;
    notes = 'Very cold';
  } else if (tminF > 5) {
    points = 0.65 + (15 - tminF) * 0.06;
    notes = 'Bitter cold';
  } else if (tminF > -5) {
    points = 1.25 + (5 - tminF) * 0.04;
    notes = 'Dangerous cold';
  } else if (tminF > -15) {
    points = 1.65 + (-5 - tminF) * 0.015;
    notes = 'Extreme cold';
  } else {
    points = 1.8;
    notes = 'Life-threatening cold';
  }

  return {
    points: Math.min(1.8, points),
    observed: `${Math.round(tminF)}°F`,
    notes,
    category: 'Cold Intensity',
  };
}

/**
 * Factor 11: Heat Intensity (tmax)
 * Max points: 2.5
 */
function scoreHeatIntensity(tmaxF: number): FactorResult {
  let points = 0;
  let notes = 'Normal';

  if (tmaxF < 90) {
    points = 0;
    notes = 'Normal';
  } else if (tmaxF < 95) {
    points = 0.3 + (tmaxF - 90) * 0.1;
    notes = 'Hot';
  } else if (tmaxF < 100) {
    points = 0.8 + (tmaxF - 95) * 0.2;
    notes = 'Very hot';
  } else if (tmaxF < 105) {
    points = 1.8 + (tmaxF - 100) * 0.1;
    notes = 'Excessive heat';
  } else if (tmaxF < 110) {
    points = 2.3 + (tmaxF - 105) * 0.04;
    notes = 'Extreme heat';
  } else {
    points = 2.5;
    notes = 'Dangerous heat';
  }

  return {
    points: Math.min(2.5, points),
    observed: `${Math.round(tmaxF)}°F`,
    notes,
    category: 'Heat Intensity',
  };
}

/**
 * Factor 12: Wind Chill Proxy
 * CAPPED together with cold intensity
 * Max points: 1.0
 */
function scoreWindChill(tminF: number, gustMph: number): FactorResult {
  // Wind chill only significant when cold + windy
  if (tminF > 35 || gustMph < 10) {
    return { points: 0, observed: 'N/A', notes: 'Not applicable', category: 'Wind Chill' };
  }

  // Simplified wind chill formula
  const windChill = 35.74 + 0.6215 * tminF - 35.75 * Math.pow(gustMph, 0.16) + 0.4275 * tminF * Math.pow(gustMph, 0.16);
  const windChillDrop = tminF - windChill;

  let points = 0;
  let notes = 'Minor';

  if (windChill <= -30) {
    points = 1.0;
    notes = 'Extreme wind chill';
  } else if (windChill <= -15) {
    points = 0.7;
    notes = 'Dangerous wind chill';
  } else if (windChill <= 0) {
    points = 0.4;
    notes = 'Significant wind chill';
  } else if (windChill <= 15) {
    points = 0.2;
    notes = 'Noticeable wind chill';
  } else if (windChillDrop >= 10) {
    points = 0.1;
    notes = 'Minor wind chill';
  }

  return {
    points: Math.min(1.0, points),
    observed: `${Math.round(windChill)}°F feels-like`,
    notes,
    category: 'Wind Chill',
  };
}

/**
 * Factor 13: Flash Freeze / Diurnal Swing
 * Rapid temp drop creating icy conditions
 * Max points: 0.6
 */
function scoreFlashFreeze(tminF: number, tmaxF: number, hourlyTemp?: number[]): FactorResult {
  const tempSwing = tmaxF - tminF;

  // Check for crossing freezing with significant swing
  if (tmaxF < 32 || tminF > 35) {
    return { points: 0, observed: 'N/A', notes: 'No freeze transition', category: 'Flash Freeze' };
  }

  let rapidDrop = false;
  if (hourlyTemp && hourlyTemp.length >= 6) {
    // Check for 15°F+ drop in 6 hours
    for (let i = 6; i < hourlyTemp.length; i++) {
      if (hourlyTemp[i - 6] - hourlyTemp[i] >= 15) {
        rapidDrop = true;
        break;
      }
    }
  } else {
    // Estimate from diurnal range
    rapidDrop = tempSwing >= 25 && tminF <= 28;
  }

  if (!rapidDrop && tempSwing < 20) {
    return { points: 0, observed: `${tempSwing}°F swing`, notes: 'Gradual change', category: 'Flash Freeze' };
  }

  let points = 0;
  let notes = 'Minor';

  if (rapidDrop && tminF <= 25) {
    points = 0.6;
    notes = 'Significant flash freeze risk';
  } else if (rapidDrop || (tempSwing >= 25 && tminF <= 30)) {
    points = 0.4;
    notes = 'Moderate flash freeze risk';
  } else if (tempSwing >= 20 && tmaxF >= 40 && tminF <= 32) {
    points = 0.2;
    notes = 'Minor flash freeze potential';
  }

  return {
    points: Math.min(0.6, points),
    observed: `High ${Math.round(tmaxF)}°F → Low ${Math.round(tminF)}°F`,
    notes,
    category: 'Flash Freeze',
  };
}

// ============================================================================
// IMPACTS/TRAVEL FACTORS (2-4 factors)
// ============================================================================

/**
 * Factor 14: Winter Travel Hazard Index
 * Combination of snow + wind + cold
 * Max points: 1.5
 */
function scoreWinterTravel(snowIn: number, gustMph: number, tminF: number): FactorResult {
  // Need meaningful snow for winter travel impacts
  if (snowIn < 0.3) {
    return { points: 0, observed: 'N/A', notes: 'No snow accumulation', category: 'Winter Travel' };
  }

  let score = 0;
  const factors: string[] = [];

  // Snow contribution
  if (snowIn >= 4) {
    score += 0.6;
    factors.push('heavy snow');
  } else if (snowIn >= 2) {
    score += 0.4;
    factors.push('moderate snow');
  } else if (snowIn >= 1) {
    score += 0.25;
    factors.push('snow');
  } else {
    score += 0.1;
    factors.push('light snow');
  }

  // Wind adds to travel impacts
  if (gustMph >= 35 && snowIn >= 1) {
    score += 0.4;
    factors.push('blowing snow');
  } else if (gustMph >= 25 && snowIn >= 0.5) {
    score += 0.2;
    factors.push('wind');
  }

  // Cold adds to impacts
  if (tminF <= 10 && snowIn >= 1) {
    score += 0.3;
    factors.push('bitter cold');
  } else if (tminF <= 20 && snowIn >= 0.5) {
    score += 0.15;
    factors.push('cold');
  }

  // Synergy bonus
  if (factors.length >= 3) {
    score += 0.2;
  }

  return {
    points: Math.min(1.5, score),
    observed: `Snow ${snowIn.toFixed(1)}", Wind ${Math.round(gustMph)} mph, Low ${Math.round(tminF)}°F`,
    notes: factors.length > 0 ? factors.join(' + ') : 'Minimal',
    category: 'Winter Travel',
  };
}

/**
 * Factor 15: Blowing Snow / Visibility Proxy
 * Max points: 1.0
 */
function scoreBlowingSnow(snowIn: number, gustMph: number, tminF: number): FactorResult {
  // Need snow on ground and wind
  if (snowIn < 0.5 || gustMph < 20) {
    return { points: 0, observed: 'N/A', notes: 'Not applicable', category: 'Blowing Snow' };
  }

  // Cold, dry snow blows easier
  const coldFactor = tminF <= 20 ? 1.3 : tminF <= 28 ? 1.1 : 1.0;

  let points = 0;
  let notes = 'Minor';

  if (gustMph >= 45 && snowIn >= 3) {
    points = 1.0 * coldFactor;
    notes = 'Significant blowing/drifting';
  } else if (gustMph >= 35 && snowIn >= 2) {
    points = 0.6 * coldFactor;
    notes = 'Moderate blowing snow';
  } else if (gustMph >= 30 && snowIn >= 1) {
    points = 0.3 * coldFactor;
    notes = 'Light blowing snow';
  } else if (gustMph >= 25) {
    points = 0.15;
    notes = 'Occasional blowing';
  }

  return {
    points: Math.min(1.0, points),
    observed: `Snow ${snowIn.toFixed(1)}" + Gusts ${Math.round(gustMph)} mph`,
    notes,
    category: 'Blowing Snow',
  };
}

/**
 * Factor 16: Flooding Proxy
 * Based on rain amount + intensity
 * Max points: 1.5
 */
function scoreFloodingProxy(rainIn: number, hourlyPrecip?: number[]): FactorResult {
  if (rainIn < 0.5) {
    return { points: 0, observed: 'N/A', notes: 'Insufficient rain', category: 'Flooding Risk' };
  }

  let maxHourlyRain = 0;
  if (hourlyPrecip && hourlyPrecip.length > 0) {
    maxHourlyRain = Math.max(...hourlyPrecip);
  } else {
    maxHourlyRain = rainIn / 6;
  }

  let points = 0;
  let notes = 'Minor';

  // Heavy rain + high intensity = flood risk
  if (rainIn >= 3 || maxHourlyRain >= 1) {
    points = 1.5;
    notes = 'Significant flash flood risk';
  } else if (rainIn >= 2 || maxHourlyRain >= 0.5) {
    points = 1.0;
    notes = 'Moderate flood risk';
  } else if (rainIn >= 1 || maxHourlyRain >= 0.3) {
    points = 0.5;
    notes = 'Minor flood risk in prone areas';
  } else {
    points = 0.2;
    notes = 'Low flood risk';
  }

  return {
    points: Math.min(1.5, points),
    observed: `${rainIn.toFixed(2)}" total, ${maxHourlyRain.toFixed(2)}"/hr max`,
    notes,
    category: 'Flooding Risk',
  };
}

/**
 * Factor 17: Multi-Hazard Day Bonus
 * Small bonus when 2+ significant hazards present
 * Max points: 0.5
 */
function scoreMultiHazardBonus(factors: FactorResult[]): FactorResult {
  // Count significant hazards (>= 0.5 points)
  const significantHazards = factors.filter(f =>
    f.points >= 0.5 &&
    !['Multi-Hazard', 'Winter Travel', 'Blowing Snow', 'Wind Chill', 'Wind Duration', 'Flash Freeze'].includes(f.category)
  );

  const hazardNames = significantHazards.map(f => f.category);
  let points = 0;
  let notes = 'Single hazard or quiet';

  if (hazardNames.length >= 4) {
    points = 0.5;
    notes = 'Multiple significant hazards';
  } else if (hazardNames.length >= 3) {
    points = 0.4;
    notes = '3 hazards combining';
  } else if (hazardNames.length >= 2) {
    points = 0.25;
    notes = '2 hazards present';
  }

  return {
    points,
    observed: `${hazardNames.length} active hazards`,
    notes: hazardNames.length > 0 ? hazardNames.slice(0, 3).join(', ') : notes,
    category: 'Multi-Hazard',
  };
}

// ============================================================================
// OVERLAY FACTORS (Days 1-3 only)
// ============================================================================

/**
 * Factor 18: SPC Convective Outlook
 * Max points: 8.0
 */
function scoreSPCOverlay(spcCategory?: string, dayIndex?: number): FactorResult {
  if (!spcCategory || (dayIndex && dayIndex > 3)) {
    return { points: 0, observed: 'N/A', notes: 'None', category: 'SPC Outlook' };
  }

  const points = SPC_MODIFIERS[spcCategory] || 0;

  const notes: Record<string, string> = {
    'MRGL': 'Marginal severe risk',
    'SLGT': 'Slight severe risk',
    'ENH': 'Enhanced severe risk',
    'MDT': 'Moderate severe risk',
    'HIGH': 'High severe risk',
  };

  return {
    points: Math.min(8.0, points),
    observed: spcCategory,
    notes: notes[spcCategory] || 'Severe risk',
    category: 'SPC Outlook',
  };
}

/**
 * Factor 19: WPC Excessive Rainfall Outlook
 * Max points: 4.5
 */
function scoreEROOverlay(eroCategory?: string, dayIndex?: number): FactorResult {
  if (!eroCategory || (dayIndex && dayIndex > 3)) {
    return { points: 0, observed: 'N/A', notes: 'None', category: 'WPC ERO' };
  }

  const points = ERO_MODIFIERS[eroCategory] || 0;

  const notes: Record<string, string> = {
    'MRGL': 'Marginal excessive rainfall risk',
    'SLGT': 'Slight excessive rainfall risk',
    'MDT': 'Moderate excessive rainfall risk',
    'HIGH': 'High excessive rainfall risk',
  };

  return {
    points: Math.min(4.5, points),
    observed: eroCategory,
    notes: notes[eroCategory] || 'Excessive rainfall risk',
    category: 'WPC ERO',
  };
}

// ============================================================================
// Main scoring function
// ============================================================================

/**
 * Calculate city risk score for a specific day with full explainability
 * @param metrics - Weather metrics for the city/day
 * @param dayIndex - 1-7 (used for overlay eligibility and damping)
 * @returns Complete risk result with 15+ factors
 */
export function calculateCityDayRisk(
  metrics: CityDayMetrics,
  dayIndex: number
): CityRiskResult {
  const allFactors: FactorResult[] = [];

  // ===== PRECIP/WINTER FACTORS =====
  allFactors.push(scoreSnowAmount(metrics.snow_in));
  allFactors.push(scoreSnowRate(metrics.snow_in, metrics.hourlySnow));
  allFactors.push(scoreSnowDuration(metrics.snow_in, metrics.hourlySnow));
  allFactors.push(scoreRainAmount(metrics.rain_in));
  allFactors.push(scoreRainIntensity(metrics.rain_in, metrics.hourlyPrecip));
  allFactors.push(scoreWintryMix(metrics.snow_in, metrics.rain_in, metrics.tmin_f, metrics.tmax_f));
  allFactors.push(scoreIceProxy(metrics.rain_in, metrics.tmin_f, metrics.tmax_f, metrics.hourlyTemp));

  // ===== WIND/TEMPERATURE FACTORS =====
  allFactors.push(scoreWindGust(metrics.wind_gust_mph));
  allFactors.push(scoreWindDuration(metrics.wind_gust_mph, metrics.hourlyWindGust));
  allFactors.push(scoreColdIntensity(metrics.tmin_f));
  allFactors.push(scoreHeatIntensity(metrics.tmax_f));
  allFactors.push(scoreWindChill(metrics.tmin_f, metrics.wind_gust_mph));
  allFactors.push(scoreFlashFreeze(metrics.tmin_f, metrics.tmax_f, metrics.hourlyTemp));

  // ===== IMPACTS/TRAVEL FACTORS =====
  allFactors.push(scoreWinterTravel(metrics.snow_in, metrics.wind_gust_mph, metrics.tmin_f));
  allFactors.push(scoreBlowingSnow(metrics.snow_in, metrics.wind_gust_mph, metrics.tmin_f));
  allFactors.push(scoreFloodingProxy(metrics.rain_in, metrics.hourlyPrecip));

  // Multi-hazard bonus (computed from other factors)
  allFactors.push(scoreMultiHazardBonus(allFactors));

  // ===== OVERLAY FACTORS (Days 1-3 only) =====
  allFactors.push(scoreSPCOverlay(metrics.spcCategory, dayIndex));
  allFactors.push(scoreEROOverlay(metrics.eroCategory, dayIndex));

  // ===== CAP COLD + WIND CHILL COMBINED =====
  const coldFactor = allFactors.find(f => f.category === 'Cold Intensity');
  const windChillFactor = allFactors.find(f => f.category === 'Wind Chill');
  if (coldFactor && windChillFactor) {
    const combinedCold = coldFactor.points + windChillFactor.points;
    if (combinedCold > 2.2) {
      // Cap combined cold contribution unless there's also precip
      const precipFactors = allFactors.filter(f =>
        ['Snow Amount', 'Rain Amount', 'Ice/Freezing Rain'].includes(f.category) && f.points > 0
      );
      if (precipFactors.length === 0) {
        // No precip, cap cold
        const excess = combinedCold - 2.2;
        windChillFactor.points = Math.max(0, windChillFactor.points - excess);
      }
    }
  }

  // ===== SUM ALL FACTORS =====
  let rawScore = allFactors.reduce((sum, f) => sum + f.points, 0);

  // Apply day damping for extended forecasts
  const damping = DAY_DAMPING[Math.min(7, Math.max(1, dayIndex))] || 1.0;
  if (rawScore > 1 && damping < 1) {
    rawScore = 1 + (rawScore - 1) * damping;
  }

  // Clamp to 0-10 range
  rawScore = Math.max(0, Math.min(10, rawScore));

  // Build breakdown (only factors with points > 0)
  const breakdown: RiskBreakdownItem[] = allFactors
    .filter(f => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .map(f => ({
      hazard: f.category,
      category: f.category,
      score: Math.round(f.points * 10) / 10,
      observed: f.observed,
      notes: f.notes,
      contribution: Math.round(f.points * 100) / 100,
      details: `${f.observed} - ${f.notes}`,
    }));

  // Build top drivers (top 3 significant factors)
  const topDrivers: RiskDriver[] = allFactors
    .filter(f => f.points >= 0.2)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map(f => ({
      hazard: f.category,
      score: Math.round(f.points * 10) / 10,
      rawValue: parseFloat(f.observed) || 0,
      unit: getUnitForCategory(f.category),
      description: f.notes,
    }));

  // Build flags
  const flags: CityRiskFlags = {
    snowPresent: metrics.snow_in >= 0.2,
    rainPresent: metrics.rain_in >= 0.05,
    heavySnow: metrics.snow_in >= 4,
    heavyRain: metrics.rain_in >= 1,
    windy: metrics.wind_gust_mph >= 30,
    veryWindy: metrics.wind_gust_mph >= 50,
    extremeCold: metrics.tmin_f <= 0,
    veryCold: metrics.tmin_f <= 10,
    extremeHeat: metrics.tmax_f >= 100,
    veryHot: metrics.tmax_f >= 95,
    wintryMix: metrics.snow_in >= 0.1 && metrics.rain_in >= 0.05,
    severeRisk: !!metrics.spcCategory && dayIndex <= 3,
    floodRisk: !!metrics.eroCategory && dayIndex <= 3,
    blowingSnow: metrics.snow_in >= 1 && metrics.wind_gust_mph >= 30,
    flashFreeze: (metrics.tmax_f - metrics.tmin_f) >= 25 && metrics.tmin_f <= 30 && metrics.tmax_f >= 35,
  };

  // Generate summary text
  const summaryText = generateSummaryText(topDrivers, flags, rawScore, dayIndex);

  return {
    score_raw: Math.round(rawScore * 100) / 100,
    score_display: Math.round(rawScore * 10) / 10,
    level: getRiskLevel(rawScore),
    summary_text: summaryText,
    top_drivers: topDrivers,
    breakdown,
    flags,
    factorCount: breakdown.length,
  };
}

/**
 * Get unit string for a category
 */
function getUnitForCategory(category: string): string {
  switch (category) {
    case 'Snow Amount':
    case 'Rain Amount':
    case 'Snow Rate':
    case 'Rain Intensity':
      return '"';
    case 'Wind Gust':
    case 'Wind Duration':
      return ' mph';
    case 'Cold Intensity':
    case 'Heat Intensity':
    case 'Wind Chill':
    case 'Flash Freeze':
      return '°F';
    default:
      return '';
  }
}

/**
 * Generate 1-2 sentence summary of why this score
 */
function generateSummaryText(
  drivers: RiskDriver[],
  flags: CityRiskFlags,
  score: number,
  dayIndex: number
): string {
  if (drivers.length === 0 || score < 1.5) {
    return 'No significant weather hazards expected.';
  }

  const sentences: string[] = [];
  const topDriver = drivers[0];

  // Primary hazard description
  if (topDriver.hazard === 'Snow Amount' && flags.snowPresent) {
    if (flags.heavySnow) {
      sentences.push(`Heavy snow expected with accumulations of ${(topDriver.rawValue ?? 0).toFixed(1)}".`);
    } else {
      sentences.push(`Snow accumulation of ${(topDriver.rawValue ?? 0).toFixed(1)}" expected.`);
    }
  } else if (topDriver.hazard === 'Rain Amount' && flags.rainPresent) {
    if (flags.heavyRain) {
      sentences.push(`Heavy rain expected with ${(topDriver.rawValue ?? 0).toFixed(2)}".`);
    } else {
      sentences.push(`Rain expected with ${(topDriver.rawValue ?? 0).toFixed(2)}".`);
    }
  } else if (topDriver.hazard === 'Wind Gust' && flags.windy) {
    if (flags.veryWindy) {
      sentences.push(`High winds with gusts to ${Math.round(topDriver.rawValue ?? 0)} mph.`);
    } else {
      sentences.push(`Windy conditions with gusts to ${Math.round(topDriver.rawValue ?? 0)} mph.`);
    }
  } else if (topDriver.hazard === 'Cold Intensity') {
    if (flags.extremeCold) {
      sentences.push(`Dangerously cold with lows near ${Math.round(topDriver.rawValue ?? 0)}°F.`);
    } else if (flags.veryCold) {
      sentences.push(`Very cold with lows near ${Math.round(topDriver.rawValue ?? 0)}°F.`);
    }
  } else if (topDriver.hazard === 'Heat Intensity') {
    if (flags.extremeHeat) {
      sentences.push(`Excessive heat with highs near ${Math.round(topDriver.rawValue ?? 0)}°F.`);
    } else if (flags.veryHot) {
      sentences.push(`Very hot with highs near ${Math.round(topDriver.rawValue ?? 0)}°F.`);
    }
  } else if (topDriver.hazard === 'Ice/Freezing Rain') {
    sentences.push('Ice accumulation possible with freezing rain.');
  } else if (topDriver.hazard === 'SPC Outlook') {
    sentences.push('Elevated severe weather risk.');
  } else if (topDriver.hazard === 'WPC ERO') {
    sentences.push('Elevated flooding risk.');
  } else if (topDriver.hazard === 'Winter Travel') {
    sentences.push('Winter travel impacts expected.');
  } else {
    sentences.push(`Primary concern: ${topDriver.description || topDriver.hazard}.`);
  }

  // Secondary concerns
  if (drivers.length >= 2 && drivers[1].score >= 0.5) {
    const secondary = drivers[1];
    if (secondary.hazard === 'Wind Gust' && flags.windy) {
      sentences.push('Strong winds will compound impacts.');
    } else if (secondary.hazard === 'Blowing Snow' && flags.blowingSnow) {
      sentences.push('Blowing snow may reduce visibility.');
    } else if (secondary.hazard === 'Cold Intensity' && flags.veryCold) {
      sentences.push('Cold temperatures add to concerns.');
    } else if (secondary.hazard === 'Winter Travel') {
      sentences.push('Travel may be hazardous.');
    }
  }

  // Extended forecast note
  if (dayIndex >= 6) {
    sentences.push('Extended forecast confidence is lower.');
  }

  return sentences.join(' ');
}

/**
 * Convert numeric score to RiskLevel
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
 * Get risk label for display
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
