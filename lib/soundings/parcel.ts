// Parcel Theory Calculations for CAPE, CIN, LFC, EL
// Implements surface-based, mixed-layer, and most-unstable parcel lifts

import {
  celsiusToKelvin,
  kelvinToCelsius,
  potentialTemperature,
  equivalentPotentialTemperature,
  mixingRatio,
  saturationMixingRatio,
  lclHeight,
  liftDryAdiabatic,
  liftMoistAdiabatic,
  virtualTemperature,
} from './thermo';
import { SoundingLevel, DerivedParameters } from './types';

const g = 9.80665;

interface ParcelPath {
  pressure_mb: number;
  height_m: number;
  parcel_temp_c: number;
  env_temp_c: number;
  buoyancy: number; // Parcel virtual temp - Env virtual temp
}

interface ParcelResult {
  lcl_m: number;
  lcl_pressure_mb: number;
  lcl_temp_c: number;
  lfc_m: number;
  lfc_pressure_mb: number;
  el_m: number;
  el_pressure_mb: number;
  cape: number;
  cin: number;
  path: ParcelPath[];
}

// Interpolate environmental temperature at a given pressure
function interpEnvTemp(
  levels: SoundingLevel[],
  targetPressure: number
): number | null {
  // Sort by pressure (descending)
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);

  for (let i = 0; i < sorted.length - 1; i++) {
    const below = sorted[i];
    const above = sorted[i + 1];

    if (targetPressure <= below.pressure_mb && targetPressure >= above.pressure_mb) {
      // Log-pressure interpolation
      const logP = Math.log(targetPressure);
      const logP1 = Math.log(below.pressure_mb);
      const logP2 = Math.log(above.pressure_mb);
      const frac = (logP - logP1) / (logP2 - logP1);
      return below.temp_c + frac * (above.temp_c - below.temp_c);
    }
  }

  return null;
}

// Interpolate environmental height at a given pressure
function interpEnvHeight(
  levels: SoundingLevel[],
  targetPressure: number
): number | null {
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);

  for (let i = 0; i < sorted.length - 1; i++) {
    const below = sorted[i];
    const above = sorted[i + 1];

    if (targetPressure <= below.pressure_mb && targetPressure >= above.pressure_mb) {
      const logP = Math.log(targetPressure);
      const logP1 = Math.log(below.pressure_mb);
      const logP2 = Math.log(above.pressure_mb);
      const frac = (logP - logP1) / (logP2 - logP1);
      return below.height_m + frac * (above.height_m - below.height_m);
    }
  }

  return null;
}

// Lift a parcel and compute CAPE/CIN
export function liftParcel(
  startTempC: number,
  startDewpointC: number,
  startPressureMb: number,
  startHeightM: number,
  envLevels: SoundingLevel[],
  topPressureMb: number = 100
): ParcelResult {
  const path: ParcelPath[] = [];

  // Compute LCL
  const lcl = lclHeight(startTempC, startDewpointC, startPressureMb, startHeightM);

  // Initialize parcel state
  let parcelTemp = startTempC;
  let currentPressure = startPressureMb;
  let currentHeight = startHeightM;
  let isSaturated = false;

  // Integration variables
  let cape = 0;
  let cin = 0;
  let lfc_m = NaN;
  let lfc_pressure_mb = NaN;
  let el_m = NaN;
  let el_pressure_mb = NaN;
  let wasPositive = false;
  let foundLFC = false;

  // Pressure step for integration
  const dp = 10; // hPa

  while (currentPressure > topPressureMb) {
    const nextPressure = currentPressure - dp;
    if (nextPressure < topPressureMb) break;

    // Get environmental temperature at current pressure
    const envTemp = interpEnvTemp(envLevels, currentPressure);
    if (envTemp === null) break;

    const envHeight = interpEnvHeight(envLevels, currentPressure);
    if (envHeight === null) break;

    // Compute virtual temperatures for buoyancy
    const parcelMixRatio = isSaturated
      ? saturationMixingRatio(currentPressure, parcelTemp)
      : mixingRatio(currentPressure, startDewpointC);
    const envMixRatio = saturationMixingRatio(currentPressure, envTemp) * 0.7; // Estimate env moisture

    const parcelTv = virtualTemperature(parcelTemp, parcelMixRatio);
    const envTv = virtualTemperature(envTemp, envMixRatio);

    const buoyancy = parcelTv - envTv;

    path.push({
      pressure_mb: currentPressure,
      height_m: envHeight,
      parcel_temp_c: parcelTemp,
      env_temp_c: envTemp,
      buoyancy,
    });

    // Lift parcel to next level
    if (!isSaturated && currentPressure > lcl.pressure_mb && nextPressure <= lcl.pressure_mb) {
      // Transition from dry to moist at LCL
      parcelTemp = liftDryAdiabatic(parcelTemp, currentPressure, lcl.pressure_mb);
      isSaturated = true;
      parcelTemp = liftMoistAdiabatic(parcelTemp, lcl.pressure_mb, nextPressure);
    } else if (isSaturated) {
      parcelTemp = liftMoistAdiabatic(parcelTemp, currentPressure, nextPressure);
    } else {
      parcelTemp = liftDryAdiabatic(parcelTemp, currentPressure, nextPressure);
    }

    // Get height change for CAPE/CIN integration
    const nextEnvHeight = interpEnvHeight(envLevels, nextPressure);
    if (nextEnvHeight === null) break;
    const dz = nextEnvHeight - envHeight;

    // Integrate CAPE/CIN
    // CAPE = integral of g * (Tv_parcel - Tv_env) / Tv_env * dz (positive buoyancy only)
    // CIN = same but for negative buoyancy below LFC
    const buoyancyTerm = g * (parcelTv - envTv) / envTv * dz;

    if (buoyancy > 0) {
      if (!foundLFC && currentPressure < lcl.pressure_mb) {
        // Found LFC (first positive buoyancy above LCL)
        lfc_m = envHeight;
        lfc_pressure_mb = currentPressure;
        foundLFC = true;
      }
      cape += buoyancyTerm;
      wasPositive = true;
    } else {
      if (!foundLFC && currentPressure < startPressureMb) {
        // Accumulate CIN below LFC
        cin += buoyancyTerm; // Will be negative
      }
      if (wasPositive && foundLFC) {
        // Found EL (first negative buoyancy after positive)
        el_m = envHeight;
        el_pressure_mb = currentPressure;
        break;
      }
    }

    currentPressure = nextPressure;
    currentHeight = nextEnvHeight;
  }

  // If we never went negative after positive, EL is at top of sounding
  if (wasPositive && isNaN(el_m)) {
    const topHeight = interpEnvHeight(envLevels, topPressureMb);
    if (topHeight !== null) {
      el_m = topHeight;
      el_pressure_mb = topPressureMb;
    }
  }

  return {
    lcl_m: lcl.height_m,
    lcl_pressure_mb: lcl.pressure_mb,
    lcl_temp_c: lcl.temp_c,
    lfc_m: isNaN(lfc_m) ? 0 : lfc_m,
    lfc_pressure_mb: isNaN(lfc_pressure_mb) ? 0 : lfc_pressure_mb,
    el_m: isNaN(el_m) ? 0 : el_m,
    el_pressure_mb: isNaN(el_pressure_mb) ? 0 : el_pressure_mb,
    cape: Math.max(0, cape),
    cin: Math.min(0, cin),
    path,
  };
}

// Surface-based parcel
export function surfaceBasedCAPE(levels: SoundingLevel[]): ParcelResult {
  // Find surface level (highest pressure)
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);
  const surface = sorted[0];

  return liftParcel(
    surface.temp_c,
    surface.dewpoint_c,
    surface.pressure_mb,
    surface.height_m,
    levels
  );
}

// Mixed-layer parcel (average of lowest 100mb)
export function mixedLayerCAPE(levels: SoundingLevel[]): ParcelResult {
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);
  const surface = sorted[0];
  const topPressure = surface.pressure_mb - 100;

  // Average theta and mixing ratio in lowest 100mb
  let sumTheta = 0;
  let sumMixRatio = 0;
  let count = 0;

  for (const level of sorted) {
    if (level.pressure_mb < topPressure) break;

    const theta = potentialTemperature(level.temp_c, level.pressure_mb);
    const w = mixingRatio(level.pressure_mb, level.dewpoint_c);

    sumTheta += theta;
    sumMixRatio += w;
    count++;
  }

  if (count === 0) {
    return liftParcel(surface.temp_c, surface.dewpoint_c, surface.pressure_mb, surface.height_m, levels);
  }

  const avgTheta = sumTheta / count;
  const avgMixRatio = sumMixRatio / count;

  // Convert average theta back to temperature at surface pressure
  const avgTempK = avgTheta * Math.pow(surface.pressure_mb / 1000, 287.05 / 1005.7);
  const avgTempC = avgTempK - 273.15;

  // Approximate dewpoint from mixing ratio
  // w = 622 * e / (p - e), solve for e, then convert to Td
  const e = (avgMixRatio * surface.pressure_mb) / (622 + avgMixRatio);
  const avgDewpointC = 243.5 * Math.log(e / 6.112) / (17.67 - Math.log(e / 6.112));

  return liftParcel(
    avgTempC,
    avgDewpointC,
    surface.pressure_mb,
    surface.height_m,
    levels
  );
}

// Most-unstable parcel (max theta-e in lowest 300mb)
export function mostUnstableCAPE(levels: SoundingLevel[]): ParcelResult {
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);
  const surface = sorted[0];
  const topPressure = surface.pressure_mb - 300;

  let maxThetaE = -Infinity;
  let muLevel: SoundingLevel | null = null;

  for (const level of sorted) {
    if (level.pressure_mb < topPressure) break;
    if (isNaN(level.temp_c) || isNaN(level.dewpoint_c)) continue;

    const thetaE = equivalentPotentialTemperature(
      level.temp_c,
      level.dewpoint_c,
      level.pressure_mb
    );

    if (thetaE > maxThetaE) {
      maxThetaE = thetaE;
      muLevel = level;
    }
  }

  if (!muLevel) {
    return liftParcel(surface.temp_c, surface.dewpoint_c, surface.pressure_mb, surface.height_m, levels);
  }

  return liftParcel(
    muLevel.temp_c,
    muLevel.dewpoint_c,
    muLevel.pressure_mb,
    muLevel.height_m,
    levels
  );
}

// Downdraft CAPE (DCAPE)
// Integration of negative buoyancy from minimum theta-e level to surface
export function downdraftCAPE(levels: SoundingLevel[]): number {
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);

  // Find minimum theta-e in 400-700mb layer
  let minThetaE = Infinity;
  let minThetaELevel: SoundingLevel | null = null;

  for (const level of sorted) {
    if (level.pressure_mb > 700 || level.pressure_mb < 400) continue;
    if (isNaN(level.temp_c) || isNaN(level.dewpoint_c)) continue;

    const thetaE = equivalentPotentialTemperature(
      level.temp_c,
      level.dewpoint_c,
      level.pressure_mb
    );

    if (thetaE < minThetaE) {
      minThetaE = thetaE;
      minThetaELevel = level;
    }
  }

  if (!minThetaELevel) return 0;

  // Descend parcel moist adiabatically to surface
  let dcape = 0;
  let parcelTemp = minThetaELevel.temp_c;
  let currentPressure = minThetaELevel.pressure_mb;

  const dp = 10;
  const surfacePressure = sorted[0].pressure_mb;

  while (currentPressure < surfacePressure) {
    const nextPressure = Math.min(currentPressure + dp, surfacePressure);

    const envTemp = interpEnvTemp(levels, currentPressure);
    if (envTemp === null) break;

    const envHeight = interpEnvHeight(levels, currentPressure);
    const nextEnvHeight = interpEnvHeight(levels, nextPressure);
    if (envHeight === null || nextEnvHeight === null) break;

    const dz = nextEnvHeight - envHeight;

    // Parcel descends moist adiabatically (saturated)
    parcelTemp = liftMoistAdiabatic(parcelTemp, currentPressure, nextPressure);

    // Virtual temperatures
    const parcelTv = celsiusToKelvin(parcelTemp);
    const envTv = celsiusToKelvin(envTemp);

    // Negative buoyancy contributes to DCAPE
    if (parcelTv < envTv) {
      dcape += g * (envTv - parcelTv) / envTv * Math.abs(dz);
    }

    currentPressure = nextPressure;
  }

  return dcape;
}

// Compute all parcel-based parameters
export function computeParcelParameters(levels: SoundingLevel[]): Partial<DerivedParameters> {
  const sbResult = surfaceBasedCAPE(levels);
  const mlResult = mixedLayerCAPE(levels);
  const muResult = mostUnstableCAPE(levels);
  const dcape = downdraftCAPE(levels);

  return {
    sbcape: sbResult.cape,
    sbcin: sbResult.cin,
    mlcape: mlResult.cape,
    mlcin: mlResult.cin,
    mucape: muResult.cape,
    mucin: muResult.cin,
    cape_jkg: muResult.cape, // Use MUCAPE as primary CAPE
    cin_jkg: muResult.cin,
    lcl_m: sbResult.lcl_m,
    lcl_pressure_mb: sbResult.lcl_pressure_mb,
    lfc_m: muResult.lfc_m,
    lfc_pressure_mb: muResult.lfc_pressure_mb,
    el_m: muResult.el_m,
    el_pressure_mb: muResult.el_pressure_mb,
    dcape,
  };
}
