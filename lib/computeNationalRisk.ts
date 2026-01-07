/**
 * Canonical National Risk Scoring Pipeline
 *
 * National score uses region RiskScoreResults:
 * - Weighted mean of region scores with high-impact tilt
 * - Breadth factor: how many regions above thresholds
 * - Dominant hazard nationally
 * - SPC/WPC/WSSI national overlay presence
 *
 * This is THE SINGLE SOURCE OF TRUTH for national risk calculation.
 * Score and explainer are derived from the same factor list.
 */

import {
  RiskFactor,
  RiskScoreResult,
  RiskLevel,
  RiskFactorCategory,
  scoreToLevel,
  deriveTopDrivers,
  round,
  clamp,
  percentile,
  applyDayDamping,
} from './riskTypes';

// ============================================================================
// Input Types
// ============================================================================

export interface RegionRiskInput {
  regionId: string;
  regionName: string;
  score: number;
  level: RiskLevel;
  // Hazard breakdowns from region factors
  snowPoints: number;
  rainPoints: number;
  icePoints: number;  // NBM FRAM ice accumulation points
  windPoints: number;
  coldPoints: number;
  heatPoints: number;
  spcPoints: number;
  eroPoints: number;
  wssiPoints: number;
  spcDay48Points: number;  // SPC Day 4-8 points
  // Coverage info
  cityCount: number;
  citiesWithSnow: number;
  citiesWithRain: number;
  citiesWithIce: number;  // Cities with NBM ice accumulation
  citiesWithWind: number;
  citiesWithSPC: number;
  citiesWithERO: number;
  citiesWithWSSI: number;
  citiesWithSPCDay48: number;  // Cities with SPC Day 4-8 risk
}

// ============================================================================
// Factor Functions
// ============================================================================

/**
 * Factor: High-Impact Regions (top 3 weighted)
 * Regions with highest risk get weighted more heavily
 */
function factorHighImpactRegions(
  regions: RegionRiskInput[],
  dayIndex: number
): RiskFactor {
  if (regions.length === 0) {
    return {
      id: 'high_impact_regions',
      label: 'High-Impact Regions (top 3)',
      category: 'distribution',
      observed: 'N/A',
      points: 0,
      notes: 'No region data',
      dayIndex,
      scope: 'national',
    };
  }

  // Sort by score descending
  const sorted = [...regions].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  // Weighted average: top 3 get 60% weight, rest get 40%
  let weightedSum = 0;
  let totalWeight = 0;

  top3.forEach((r, i) => {
    const weight = 3 - i; // 3, 2, 1 for top 3
    weightedSum += r.score * weight;
    totalWeight += weight;
  });

  rest.forEach(r => {
    weightedSum += r.score * 0.5;
    totalWeight += 0.5;
  });

  const weightedMean = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Points contribution - weighted mean scaled
  const points = weightedMean * 0.5;

  const topRegionNames = top3.map(r => r.regionName).join(', ');

  return {
    id: 'high_impact_regions',
    label: 'High-Impact Regions (top 3)',
    category: 'distribution',
    observed: `Top: ${topRegionNames}`,
    points: round(Math.min(5.0, points), 2),
    notes: top3[0]?.score >= 5 ? 'Significant regional impacts' :
           top3[0]?.score >= 3 ? 'Moderate regional impacts' : 'Low regional impacts',
    dayIndex,
    scope: 'national',
    meta: { weightedMean, top3: top3.map(r => ({ name: r.regionName, score: r.score })) },
  };
}

/**
 * Factor: Breadth of Impacts
 * How many regions are above certain thresholds
 */
function factorBreadthOfImpacts(
  regions: RegionRiskInput[],
  dayIndex: number
): RiskFactor {
  if (regions.length === 0) {
    return {
      id: 'breadth_of_impacts',
      label: 'Breadth of Impacts',
      category: 'distribution',
      observed: 'N/A',
      points: 0,
      notes: 'No region data',
      dayIndex,
      scope: 'national',
    };
  }

  const regionsAbove3 = regions.filter(r => r.score >= 3).length;
  const regionsAbove5 = regions.filter(r => r.score >= 5).length;
  const regionsAbove7 = regions.filter(r => r.score >= 7).length;

  let points = 0;
  let notes = 'Impacts limited';

  // >= 7 is significant event
  if (regionsAbove7 >= 3) {
    points = 1.5;
    notes = `${regionsAbove7} regions with major impacts`;
  } else if (regionsAbove7 >= 2) {
    points = 1.2;
    notes = `${regionsAbove7} regions with major impacts`;
  } else if (regionsAbove7 >= 1) {
    points = 0.8;
    notes = `Major impacts in ${regionsAbove7} region(s)`;
  }
  // >= 5 is elevated
  else if (regionsAbove5 >= 4) {
    points = 1.0;
    notes = `${regionsAbove5} regions elevated`;
  } else if (regionsAbove5 >= 2) {
    points = 0.6;
    notes = `${regionsAbove5} regions elevated`;
  }
  // >= 3 is active
  else if (regionsAbove3 >= 5) {
    points = 0.5;
    notes = `${regionsAbove3} regions active`;
  } else if (regionsAbove3 >= 3) {
    points = 0.3;
    notes = `${regionsAbove3} regions active`;
  } else if (regionsAbove3 >= 1) {
    points = 0.15;
    notes = `${regionsAbove3} region(s) active`;
  }

  return {
    id: 'breadth_of_impacts',
    label: 'Breadth of Impacts',
    category: 'distribution',
    observed: `${regionsAbove3}/${regions.length} >= 3, ${regionsAbove5}/${regions.length} >= 5, ${regionsAbove7}/${regions.length} >= 7`,
    points: round(points, 2),
    notes,
    dayIndex,
    scope: 'national',
    meta: { regionsAbove3, regionsAbove5, regionsAbove7, totalRegions: regions.length },
  };
}

/**
 * Factor: Dominant Hazard Nationally
 * Derived from region hazard factors totals
 */
function factorDominantHazard(
  regions: RegionRiskInput[],
  dayIndex: number
): RiskFactor {
  if (regions.length === 0) {
    return {
      id: 'dominant_hazard',
      label: 'Dominant Hazard Nationally',
      category: 'synergy',
      observed: 'N/A',
      points: 0,
      notes: 'No region data',
      dayIndex,
      scope: 'national',
    };
  }

  // Sum hazard points across all regions
  const hazardTotals = {
    snow: regions.reduce((sum, r) => sum + r.snowPoints, 0),
    rain: regions.reduce((sum, r) => sum + r.rainPoints, 0),
    ice: regions.reduce((sum, r) => sum + r.icePoints, 0),
    wind: regions.reduce((sum, r) => sum + r.windPoints, 0),
    cold: regions.reduce((sum, r) => sum + r.coldPoints, 0),
    heat: regions.reduce((sum, r) => sum + r.heatPoints, 0),
  };

  // Find dominant hazard
  const entries = Object.entries(hazardTotals) as [string, number][];
  entries.sort((a, b) => b[1] - a[1]);

  const [dominantType, dominantPoints] = entries[0];
  const [secondaryType, secondaryPoints] = entries[1] || ['none', 0];

  // Points based on dominant hazard strength
  let points = 0;
  let notes = 'No dominant hazard';

  const avgDominant = dominantPoints / regions.length;

  if (avgDominant >= 2) {
    points = 1.2;
    notes = `${dominantType.charAt(0).toUpperCase() + dominantType.slice(1)} is dominant threat`;
  } else if (avgDominant >= 1) {
    points = 0.7;
    notes = `${dominantType.charAt(0).toUpperCase() + dominantType.slice(1)} is primary concern`;
  } else if (avgDominant >= 0.5) {
    points = 0.35;
    notes = `${dominantType.charAt(0).toUpperCase() + dominantType.slice(1)} hazard present`;
  } else if (dominantPoints > 0) {
    points = 0.15;
    notes = `Minor ${dominantType} impacts`;
  }

  // Multi-hazard bonus if secondary is also significant
  const avgSecondary = secondaryPoints / regions.length;
  if (avgDominant >= 1 && avgSecondary >= 0.8) {
    points += 0.25;
    notes += ` with ${secondaryType}`;
  }

  return {
    id: 'dominant_hazard',
    label: 'Dominant Hazard Nationally',
    category: 'synergy',
    observed: `${dominantType}: ${round(dominantPoints, 1)} pts total`,
    points: round(Math.min(1.5, points), 2),
    notes,
    dayIndex,
    scope: 'national',
    meta: { dominantType, dominantPoints, secondaryType, secondaryPoints, hazardTotals },
  };
}

/**
 * Factor: SPC National Overlay Presence
 * Count of affected regions/cities with SPC risk
 */
function factorSPCNational(
  regions: RegionRiskInput[],
  dayIndex: number
): RiskFactor {
  if (regions.length === 0 || dayIndex > 3) {
    return {
      id: 'spc_national',
      label: 'SPC National Outlook',
      category: 'overlay',
      observed: dayIndex > 3 ? 'N/A (Day 4+)' : 'None',
      points: 0,
      notes: dayIndex > 3 ? 'SPC only valid Days 1-3' : 'No SPC risk',
      dayIndex,
      scope: 'national',
    };
  }

  // Count regions and cities with SPC
  const regionsWithSPC = regions.filter(r => r.spcPoints > 0).length;
  const totalSPCCities = regions.reduce((sum, r) => sum + r.citiesWithSPC, 0);
  const totalCities = regions.reduce((sum, r) => sum + r.cityCount, 0);
  const totalSPCPoints = regions.reduce((sum, r) => sum + r.spcPoints, 0);

  if (regionsWithSPC === 0) {
    return {
      id: 'spc_national',
      label: 'SPC National Outlook',
      category: 'overlay',
      observed: 'None',
      points: 0,
      notes: 'No SPC risk',
      dayIndex,
      scope: 'national',
    };
  }

  // Points based on coverage and intensity
  const avgSPCPoints = totalSPCPoints / regionsWithSPC;
  const coverageFraction = totalSPCCities / totalCities;

  let points = 0;
  let notes = 'Limited severe risk';

  if (avgSPCPoints >= 5 && regionsWithSPC >= 3) {
    points = 2.5;
    notes = 'Widespread significant severe risk';
  } else if (avgSPCPoints >= 3 || regionsWithSPC >= 4) {
    points = 1.8;
    notes = 'Elevated severe risk multiple regions';
  } else if (avgSPCPoints >= 2 || regionsWithSPC >= 2) {
    points = 1.2;
    notes = 'Moderate severe risk';
  } else if (regionsWithSPC >= 1) {
    points = 0.6;
    notes = 'Localized severe risk';
  }

  return {
    id: 'spc_national',
    label: 'SPC National Outlook',
    category: 'overlay',
    observed: `${regionsWithSPC}/${regions.length} regions, ${totalSPCCities}/${totalCities} cities`,
    points: round(Math.min(3.0, points), 2),
    notes,
    dayIndex,
    scope: 'national',
    meta: { regionsWithSPC, totalSPCCities, totalCities, avgSPCPoints },
  };
}

/**
 * Factor: SPC Day 4-8 National Outlook Presence
 * Count of affected regions/cities with SPC Day 4-8 risk
 */
function factorSPCDay48National(
  regions: RegionRiskInput[],
  dayIndex: number
): RiskFactor {
  if (regions.length === 0 || dayIndex < 4 || dayIndex > 8) {
    return {
      id: 'spc_day48_national',
      label: 'SPC Day 4-8 National Outlook',
      category: 'overlay',
      observed: (dayIndex < 4) ? 'N/A (Day 1-3)' : (dayIndex > 8) ? 'N/A (Day 9+)' : 'None',
      points: 0,
      notes: (dayIndex < 4) ? 'Day 4-8 outlook only valid Days 4-8' : 'No SPC D4-8 risk',
      dayIndex,
      scope: 'national',
    };
  }

  // Count regions and cities with SPC Day 4-8
  const regionsWithSPCDay48 = regions.filter(r => r.spcDay48Points > 0).length;
  const totalSPCDay48Cities = regions.reduce((sum, r) => sum + r.citiesWithSPCDay48, 0);
  const totalCities = regions.reduce((sum, r) => sum + r.cityCount, 0);
  const totalSPCDay48Points = regions.reduce((sum, r) => sum + r.spcDay48Points, 0);

  if (regionsWithSPCDay48 === 0) {
    return {
      id: 'spc_day48_national',
      label: 'SPC Day 4-8 National Outlook',
      category: 'overlay',
      observed: 'None',
      points: 0,
      notes: 'No SPC D4-8 risk',
      dayIndex,
      scope: 'national',
    };
  }

  // Points based on coverage and intensity
  const avgSPCDay48Points = totalSPCDay48Points / regionsWithSPCDay48;

  let points = 0;
  let notes = 'Limited severe risk (D4-8)';

  if (avgSPCDay48Points >= 3 && regionsWithSPCDay48 >= 3) {
    points = 2.0;
    notes = 'Widespread severe risk (D4-8)';
  } else if (avgSPCDay48Points >= 2 || regionsWithSPCDay48 >= 3) {
    points = 1.5;
    notes = 'Elevated severe risk multiple regions (D4-8)';
  } else if (avgSPCDay48Points >= 1.5 || regionsWithSPCDay48 >= 2) {
    points = 1.0;
    notes = 'Moderate severe risk (D4-8)';
  } else if (regionsWithSPCDay48 >= 1) {
    points = 0.5;
    notes = 'Localized severe risk (D4-8)';
  }

  return {
    id: 'spc_day48_national',
    label: 'SPC Day 4-8 National Outlook',
    category: 'overlay',
    observed: `${regionsWithSPCDay48}/${regions.length} regions, ${totalSPCDay48Cities}/${totalCities} cities`,
    points: round(Math.min(2.5, points), 2),
    notes,
    dayIndex,
    scope: 'national',
    meta: { regionsWithSPCDay48, totalSPCDay48Cities, totalCities, avgSPCDay48Points },
  };
}

/**
 * Factor: WPC ERO National Presence
 * Count of affected regions/cities with ERO risk (Days 1-5)
 */
function factorERONational(
  regions: RegionRiskInput[],
  dayIndex: number
): RiskFactor {
  if (regions.length === 0 || dayIndex > 5) {
    return {
      id: 'ero_national',
      label: 'WPC ERO National Outlook',
      category: 'overlay',
      observed: dayIndex > 5 ? 'N/A (Day 6+)' : 'None',
      points: 0,
      notes: dayIndex > 5 ? 'ERO only valid Days 1-5' : 'No ERO risk',
      dayIndex,
      scope: 'national',
    };
  }

  // Count regions and cities with ERO
  const regionsWithERO = regions.filter(r => r.eroPoints > 0).length;
  const totalEROCities = regions.reduce((sum, r) => sum + r.citiesWithERO, 0);
  const totalCities = regions.reduce((sum, r) => sum + r.cityCount, 0);
  const totalEROPoints = regions.reduce((sum, r) => sum + r.eroPoints, 0);

  if (regionsWithERO === 0) {
    return {
      id: 'ero_national',
      label: 'WPC ERO National Outlook',
      category: 'overlay',
      observed: 'None',
      points: 0,
      notes: 'No ERO risk',
      dayIndex,
      scope: 'national',
    };
  }

  // Points based on coverage and intensity
  const avgEROPoints = totalEROPoints / regionsWithERO;

  let points = 0;
  let notes = 'Limited flood risk';

  if (avgEROPoints >= 2 && regionsWithERO >= 3) {
    points = 1.5;
    notes = 'Widespread flood risk';
  } else if (avgEROPoints >= 1 || regionsWithERO >= 3) {
    points = 1.0;
    notes = 'Elevated flood risk multiple regions';
  } else if (regionsWithERO >= 2) {
    points = 0.6;
    notes = 'Moderate flood risk';
  } else if (regionsWithERO >= 1) {
    points = 0.3;
    notes = 'Localized flood risk';
  }

  return {
    id: 'ero_national',
    label: 'WPC ERO National Outlook',
    category: 'overlay',
    observed: `${regionsWithERO}/${regions.length} regions, ${totalEROCities}/${totalCities} cities`,
    points: round(Math.min(2.0, points), 2),
    notes,
    dayIndex,
    scope: 'national',
    meta: { regionsWithERO, totalEROCities, totalCities, avgEROPoints },
  };
}

/**
 * Factor: WPC WSSI National Presence
 * Count of affected regions/cities with WSSI risk
 */
function factorWSSINational(
  regions: RegionRiskInput[],
  dayIndex: number
): RiskFactor {
  if (regions.length === 0 || dayIndex > 3) {
    return {
      id: 'wssi_national',
      label: 'WSSI National Winter Storm',
      category: 'overlay',
      observed: dayIndex > 3 ? 'N/A (Day 4+)' : 'None',
      points: 0,
      notes: dayIndex > 3 ? 'WSSI only valid Days 1-3' : 'No WSSI risk',
      dayIndex,
      scope: 'national',
    };
  }

  // Count regions and cities with WSSI
  const regionsWithWSSI = regions.filter(r => r.wssiPoints > 0).length;
  const totalWSSICities = regions.reduce((sum, r) => sum + r.citiesWithWSSI, 0);
  const totalCities = regions.reduce((sum, r) => sum + r.cityCount, 0);
  const totalWSSIPoints = regions.reduce((sum, r) => sum + r.wssiPoints, 0);

  if (regionsWithWSSI === 0) {
    return {
      id: 'wssi_national',
      label: 'WSSI National Winter Storm',
      category: 'overlay',
      observed: 'None',
      points: 0,
      notes: 'No WSSI risk',
      dayIndex,
      scope: 'national',
    };
  }

  // Points based on coverage and intensity
  const avgWSSIPoints = totalWSSIPoints / regionsWithWSSI;

  let points = 0;
  let notes = 'Limited winter storm risk';

  if (avgWSSIPoints >= 3.5 && regionsWithWSSI >= 3) {
    points = 2.0;
    notes = 'Widespread significant winter storm impacts';
  } else if (avgWSSIPoints >= 2 && regionsWithWSSI >= 3) {
    points = 1.5;
    notes = 'Elevated winter storm impacts multiple regions';
  } else if (avgWSSIPoints >= 1.5 || regionsWithWSSI >= 3) {
    points = 1.0;
    notes = 'Moderate winter storm impacts';
  } else if (regionsWithWSSI >= 2) {
    points = 0.6;
    notes = 'Moderate winter storm risk';
  } else if (regionsWithWSSI >= 1) {
    points = 0.3;
    notes = 'Localized winter storm risk';
  }

  return {
    id: 'wssi_national',
    label: 'WSSI National Winter Storm',
    category: 'overlay',
    observed: `${regionsWithWSSI}/${regions.length} regions, ${totalWSSICities}/${totalCities} cities`,
    points: round(Math.min(2.5, points), 2),
    notes,
    dayIndex,
    scope: 'national',
    meta: { regionsWithWSSI, totalWSSICities, totalCities, avgWSSIPoints },
  };
}

// ============================================================================
// Summary Generation
// ============================================================================

function generateNationalSummary(
  factors: RiskFactor[],
  regions: RegionRiskInput[],
  score: number,
  dayIndex: number
): string {
  if (score < 1.5 || regions.length === 0) {
    return 'No significant weather hazards expected nationally.';
  }

  const sentences: string[] = [];
  const topDrivers = deriveTopDrivers(factors);

  // High impact regions info
  const sorted = [...regions].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3).filter(r => r.score >= 3);

  if (top3.length > 0) {
    const names = top3.map(r => r.regionName).join(', ');
    sentences.push(`Highest impacts in ${names}.`);
  }

  // Dominant hazard
  const dominantFactor = factors.find(f => f.id === 'dominant_hazard');
  if (dominantFactor && dominantFactor.points >= 0.5) {
    const hazardType = dominantFactor.meta?.dominantType;
    if (hazardType && hazardType !== 'none') {
      sentences.push(`${hazardType.charAt(0).toUpperCase() + hazardType.slice(1)} is the primary concern.`);
    }
  }

  // Breadth
  const breadthFactor = factors.find(f => f.id === 'breadth_of_impacts');
  if (breadthFactor && breadthFactor.points >= 0.5) {
    const { regionsAbove5, regionsAbove3 } = breadthFactor.meta || {};
    if (regionsAbove5 >= 3) {
      sentences.push(`${regionsAbove5} regions seeing elevated impacts.`);
    } else if (regionsAbove3 >= 4) {
      sentences.push(`Active weather across ${regionsAbove3} regions.`);
    }
  }

  // SPC/ERO/WSSI
  const spcFactor = factors.find(f => f.id === 'spc_national');
  const wssiFactor = factors.find(f => f.id === 'wssi_national');
  if (spcFactor && spcFactor.points >= 1) {
    sentences.push('Severe weather risk present in multiple regions.');
  }
  if (wssiFactor && wssiFactor.points >= 1) {
    sentences.push('Winter storm impacts expected in multiple regions.');
  }

  if (dayIndex >= 6) {
    sentences.push('Extended range forecast confidence is lower.');
  }

  return sentences.length > 0 ? sentences.join(' ') : 'Weather impacts expected across portions of the country.';
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Compute national risk score for a specific day with full factor breakdown
 *
 * @param dayIndex - 1-7 (Day 1 = today)
 * @param regionRiskResults - Array of region risk results with scores and hazard data
 * @returns RiskScoreResult with factors, score, and explainer (2 decimal precision)
 */
export function computeNationalRisk(
  dayIndex: number,
  regionRiskResults: RegionRiskInput[]
): RiskScoreResult {
  const dayIdx = Math.max(1, Math.min(7, dayIndex));

  if (regionRiskResults.length === 0) {
    return {
      score_raw: 1.0,
      score_display: 1.0,
      level: 'very-quiet',
      factors: [],
      top_drivers: [],
      summary: 'No data available.',
    };
  }

  const factors: RiskFactor[] = [];

  // ===== DISTRIBUTION FACTORS =====
  factors.push(factorHighImpactRegions(regionRiskResults, dayIdx));
  factors.push(factorBreadthOfImpacts(regionRiskResults, dayIdx));

  // ===== HAZARD SYNERGY FACTOR =====
  factors.push(factorDominantHazard(regionRiskResults, dayIdx));

  // ===== OVERLAY FACTORS =====
  // Days 1-3: SPC, ERO, WSSI
  factors.push(factorSPCNational(regionRiskResults, dayIdx));
  factors.push(factorERONational(regionRiskResults, dayIdx));
  factors.push(factorWSSINational(regionRiskResults, dayIdx));
  // Days 4-8: SPC Day 4-8 probabilistic outlook
  factors.push(factorSPCDay48National(regionRiskResults, dayIdx));

  // ===== COMPUTE FINAL SCORE =====
  // Sum all factor points - this IS the score
  let rawScore = factors.reduce((sum, f) => sum + f.points, 0);

  // Apply day damping for extended forecasts
  rawScore = applyDayDamping(rawScore, dayIdx);

  // Clamp to 0-10
  rawScore = clamp(rawScore, 0, 10);

  // ===== BUILD RESULT =====
  const topDrivers = deriveTopDrivers(factors);
  const summary = generateNationalSummary(factors, regionRiskResults, rawScore, dayIdx);

  return {
    score_raw: round(rawScore, 2),
    score_display: round(rawScore, 2),  // National uses 2 decimals
    level: scoreToLevel(rawScore),
    factors,
    top_drivers: topDrivers,
    summary,
  };
}

/**
 * Helper to extract region risk input from a computed region result
 */
export function extractRegionRiskInput(
  regionId: string,
  regionName: string,
  regionResult: RiskScoreResult,
  cityData: { cityCount: number; citiesWithSnow: number; citiesWithRain: number; citiesWithIce: number; citiesWithWind: number; citiesWithSPC: number; citiesWithERO: number; citiesWithWSSI: number; citiesWithSPCDay48: number }
): RegionRiskInput {
  const getPoints = (id: string) => regionResult.factors.find(f => f.id === id)?.points || 0;

  return {
    regionId,
    regionName,
    score: regionResult.score_display,
    level: regionResult.level,
    snowPoints: getPoints('snow_hazard'),
    rainPoints: getPoints('rain_hazard'),
    icePoints: getPoints('ice_hazard'),
    windPoints: getPoints('wind_hazard'),
    coldPoints: getPoints('cold_hazard'),
    heatPoints: getPoints('heat_hazard'),
    spcPoints: getPoints('spc_overlay'),
    eroPoints: getPoints('wpc_ero_overlay'),
    wssiPoints: getPoints('wpc_wssi_overlay'),
    spcDay48Points: getPoints('spc_day48_overlay'),
    cityCount: cityData.cityCount,
    citiesWithSnow: cityData.citiesWithSnow,
    citiesWithRain: cityData.citiesWithRain,
    citiesWithIce: cityData.citiesWithIce,
    citiesWithWind: cityData.citiesWithWind,
    citiesWithSPC: cityData.citiesWithSPC,
    citiesWithERO: cityData.citiesWithERO,
    citiesWithWSSI: cityData.citiesWithWSSI,
    citiesWithSPCDay48: cityData.citiesWithSPCDay48,
  };
}
