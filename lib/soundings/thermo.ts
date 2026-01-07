// Thermodynamic Calculations for Sounding Analysis
// Implements standard meteorological formulas for derived parameters

// Physical constants
const Rd = 287.05;     // Gas constant for dry air (J/kg/K)
const Rv = 461.5;      // Gas constant for water vapor (J/kg/K)
const Cp = 1005.7;     // Specific heat at constant pressure (J/kg/K)
const Lv = 2.501e6;    // Latent heat of vaporization (J/kg)
const g = 9.80665;     // Gravitational acceleration (m/s^2)
const eps = Rd / Rv;   // Ratio of gas constants (~0.622)
const P0 = 1000;       // Reference pressure (hPa)
const T0 = 273.15;     // 0°C in Kelvin

// Convert temperature between Celsius and Kelvin
export function celsiusToKelvin(c: number): number {
  return c + T0;
}

export function kelvinToCelsius(k: number): number {
  return k - T0;
}

// Convert wind from knots to m/s
export function knotsToMs(kt: number): number {
  return kt * 0.514444;
}

export function msToKnots(ms: number): number {
  return ms / 0.514444;
}

// Saturation vapor pressure (Bolton 1980)
// e_s in hPa, T in Celsius
export function saturationVaporPressure(tempC: number): number {
  return 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
}

// Vapor pressure from dewpoint (hPa)
export function vaporPressure(dewpointC: number): number {
  return saturationVaporPressure(dewpointC);
}

// Relative humidity (%)
export function relativeHumidity(tempC: number, dewpointC: number): number {
  const es = saturationVaporPressure(tempC);
  const e = saturationVaporPressure(dewpointC);
  return Math.min(100, Math.max(0, (e / es) * 100));
}

// Mixing ratio (g/kg)
// p in hPa, e in hPa
export function mixingRatio(pressureMb: number, dewpointC: number): number {
  const e = vaporPressure(dewpointC);
  return (1000 * eps * e) / (pressureMb - e);
}

// Saturation mixing ratio (g/kg)
export function saturationMixingRatio(pressureMb: number, tempC: number): number {
  const es = saturationVaporPressure(tempC);
  return (1000 * eps * es) / (pressureMb - es);
}

// Potential temperature (K)
// Using Poisson's equation: theta = T * (P0/P)^(Rd/Cp)
export function potentialTemperature(tempC: number, pressureMb: number): number {
  const T = celsiusToKelvin(tempC);
  return T * Math.pow(P0 / pressureMb, Rd / Cp);
}

// Virtual temperature (K)
// Accounts for moisture content
export function virtualTemperature(tempC: number, mixingRatioGkg: number): number {
  const T = celsiusToKelvin(tempC);
  const w = mixingRatioGkg / 1000; // Convert to kg/kg
  return T * (1 + w / eps) / (1 + w);
}

// Equivalent potential temperature (K) - Bolton (1980)
export function equivalentPotentialTemperature(
  tempC: number,
  dewpointC: number,
  pressureMb: number
): number {
  const T = celsiusToKelvin(tempC);
  const Td = celsiusToKelvin(dewpointC);
  const e = vaporPressure(dewpointC);
  const w = mixingRatio(pressureMb, dewpointC) / 1000; // kg/kg

  // LCL temperature (Bolton 1980, Eq. 15)
  const Tlcl =
    1 / (1 / (Td - 56) + Math.log(T / Td) / 800) + 56;

  // Equivalent potential temperature (Bolton 1980, Eq. 43)
  const thetaDl =
    T *
    Math.pow(P0 / pressureMb, 0.2854 * (1 - 0.28 * w)) *
    Math.exp(
      ((3.376 / Tlcl - 0.00254) * w * 1000 * (1 + 0.81 * w))
    );

  return thetaDl;
}

// Wet bulb temperature (°C) - Stull (2011) approximation
export function wetBulbTemperature(tempC: number, rh: number): number {
  const T = tempC;
  const RH = rh;

  // Stull (2011) formula - accurate to ±0.3°C for typical conditions
  const Tw =
    T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) +
    Math.atan(T + RH) -
    Math.atan(RH - 1.676331) +
    0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
    4.686035;

  return Tw;
}

// Lifted Condensation Level (LCL) height (m AGL)
// Using Bolton (1980) formula
export function lclHeight(
  tempC: number,
  dewpointC: number,
  surfacePressureMb: number,
  surfaceHeightM: number
): { height_m: number; pressure_mb: number; temp_c: number } {
  const T = celsiusToKelvin(tempC);
  const Td = celsiusToKelvin(dewpointC);

  // LCL temperature (Bolton 1980)
  const Tlcl = 1 / (1 / (Td - 56) + Math.log(T / Td) / 800) + 56;

  // Pressure at LCL using dry adiabatic lapse rate
  const Plcl = surfacePressureMb * Math.pow(Tlcl / T, Cp / Rd);

  // Height using hypsometric equation (approximate)
  const avgT = (T + Tlcl) / 2;
  const heightLcl = (Rd * avgT / g) * Math.log(surfacePressureMb / Plcl);

  return {
    height_m: heightLcl,
    pressure_mb: Plcl,
    temp_c: kelvinToCelsius(Tlcl),
  };
}

// Dry adiabatic lapse rate: ~9.8 K/km
export const DRY_LAPSE_RATE = g / Cp; // K/m = 0.00976

// Moist adiabatic lapse rate (K/m) - varies with temperature
export function moistAdiabaticLapseRate(tempC: number, pressureMb: number): number {
  const T = celsiusToKelvin(tempC);
  const es = saturationVaporPressure(tempC);
  const ws = saturationMixingRatio(pressureMb, tempC) / 1000; // kg/kg

  // Moist adiabatic lapse rate formula
  const numerator = 1 + (Lv * ws) / (Rd * T);
  const denominator = 1 + (Lv * Lv * ws * eps) / (Cp * Rd * T * T);

  return (g / Cp) * (numerator / denominator);
}

// Lift a parcel dry adiabatically from one pressure to another
export function liftDryAdiabatic(
  tempC: number,
  fromPressureMb: number,
  toPressureMb: number
): number {
  const T = celsiusToKelvin(tempC);
  const theta = potentialTemperature(tempC, fromPressureMb);
  const Tnew = theta * Math.pow(toPressureMb / P0, Rd / Cp);
  return kelvinToCelsius(Tnew);
}

// Lift a parcel moist adiabatically (iterative)
export function liftMoistAdiabatic(
  tempC: number,
  fromPressureMb: number,
  toPressureMb: number,
  stepMb: number = 10
): number {
  let T = tempC;
  let p = fromPressureMb;

  const direction = toPressureMb < fromPressureMb ? -1 : 1;
  const step = direction * Math.abs(stepMb);

  while ((direction < 0 && p > toPressureMb) || (direction > 0 && p < toPressureMb)) {
    const nextP = p + step;
    const actualNextP = direction < 0
      ? Math.max(nextP, toPressureMb)
      : Math.min(nextP, toPressureMb);

    // Estimate height change
    const avgT = celsiusToKelvin(T);
    const dz = -(Rd * avgT / g) * Math.log(actualNextP / p);

    // Apply moist adiabatic cooling
    const gamma = moistAdiabaticLapseRate(T, p);
    T = T - gamma * dz;

    p = actualNextP;
  }

  return T;
}

// Precipitable water (mm) - integrate mixing ratio through column
export function precipitableWater(
  levels: { pressure_mb: number; dewpoint_c: number }[]
): number {
  if (levels.length < 2) return 0;

  let pw = 0;

  // Sort by pressure (high to low)
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);

  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i].pressure_mb;
    const p2 = sorted[i + 1].pressure_mb;
    const w1 = mixingRatio(p1, sorted[i].dewpoint_c);
    const w2 = mixingRatio(p2, sorted[i + 1].dewpoint_c);

    // Average mixing ratio for layer (g/kg -> kg/kg)
    const wAvg = ((w1 + w2) / 2) / 1000;

    // Layer depth in pressure (Pa)
    const dp = (p1 - p2) * 100;

    // Integrate: pw = (1/g) * integral(w * dp)
    pw += (wAvg * dp) / g;
  }

  // Convert from kg/m^2 to mm (1 kg/m^2 = 1 mm for water)
  return pw;
}

// Find temperature at a given height by interpolation
export function interpolateTemp(
  levels: { height_m: number; temp_c: number }[],
  targetHeightM: number
): number | null {
  const sorted = [...levels].sort((a, b) => a.height_m - b.height_m);

  // Find bracketing levels
  for (let i = 0; i < sorted.length - 1; i++) {
    const below = sorted[i];
    const above = sorted[i + 1];

    if (targetHeightM >= below.height_m && targetHeightM <= above.height_m) {
      const frac = (targetHeightM - below.height_m) / (above.height_m - below.height_m);
      return below.temp_c + frac * (above.temp_c - below.temp_c);
    }
  }

  return null;
}

// Find height of a specific temperature isotherm
export function findIsothermHeight(
  levels: { height_m: number; temp_c: number }[],
  targetTempC: number
): number | null {
  const sorted = [...levels].sort((a, b) => a.height_m - b.height_m);

  for (let i = 0; i < sorted.length - 1; i++) {
    const below = sorted[i];
    const above = sorted[i + 1];

    // Check if target temp is between these levels
    if (
      (below.temp_c >= targetTempC && above.temp_c <= targetTempC) ||
      (below.temp_c <= targetTempC && above.temp_c >= targetTempC)
    ) {
      // Linear interpolation
      const frac = (targetTempC - below.temp_c) / (above.temp_c - below.temp_c);
      return below.height_m + frac * (above.height_m - below.height_m);
    }
  }

  return null;
}

// Lifted Index: parcel temp at 500mb minus environmental temp at 500mb
export function liftedIndex(
  surfaceTempC: number,
  surfaceDewpointC: number,
  surfacePressureMb: number,
  envTemp500mb: number
): number {
  // Find LCL
  const lcl = lclHeight(surfaceTempC, surfaceDewpointC, surfacePressureMb, 0);

  // Lift dry adiabatically to LCL
  const tempAtLcl = liftDryAdiabatic(surfaceTempC, surfacePressureMb, lcl.pressure_mb);

  // Lift moist adiabatically from LCL to 500mb
  const parcelTemp500 = liftMoistAdiabatic(tempAtLcl, lcl.pressure_mb, 500);

  return envTemp500mb - parcelTemp500;
}

// K-Index: instability index for thunderstorms
// K = (T850 - T500) + Td850 - (T700 - Td700)
export function kIndex(
  t850: number,
  t700: number,
  t500: number,
  td850: number,
  td700: number
): number {
  return (t850 - t500) + td850 - (t700 - td700);
}

// Total Totals Index
// TT = (T850 - T500) + (Td850 - T500)
export function totalTotals(t850: number, t500: number, td850: number): number {
  const verticalTotals = t850 - t500;
  const crossTotals = td850 - t500;
  return verticalTotals + crossTotals;
}

// SWEAT Index (Severe Weather Threat)
export function sweatIndex(
  t850: number,
  td850: number,
  t500: number,
  wind850Dir: number,
  wind850Spd: number,
  wind500Dir: number,
  wind500Spd: number
): number {
  const TT = totalTotals(t850, t500, td850);

  let sweat = 0;

  // Dewpoint term
  sweat += 12 * Math.max(0, td850);

  // Total Totals term
  sweat += 20 * Math.max(0, TT - 49);

  // 850mb wind term
  sweat += 2 * wind850Spd;

  // 500mb wind term
  sweat += wind500Spd;

  // Shear term (only if conditions met)
  const shearTerm = 125 * (Math.sin((wind500Dir - wind850Dir) * Math.PI / 180) + 0.2);
  if (
    wind850Dir >= 130 && wind850Dir <= 250 &&
    wind500Dir >= 210 && wind500Dir <= 310 &&
    wind500Dir - wind850Dir > 0 &&
    wind850Spd >= 15 && wind500Spd >= 15
  ) {
    sweat += Math.max(0, shearTerm);
  }

  return Math.max(0, sweat);
}
