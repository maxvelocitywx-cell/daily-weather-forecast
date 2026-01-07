// Weather Soundings System - Type Definitions

// ============================================================================
// RAOB Station Types
// ============================================================================

export interface RAOBStation {
  id: string;              // IGRA ID (e.g., "USM00072493")
  wmo_id?: string;         // WMO station number (e.g., "72493")
  icao?: string;           // ICAO code (e.g., "KOUN")
  name: string;            // Station name (e.g., "Norman")
  state: string;           // US state abbreviation (e.g., "OK")
  lat: number;             // Latitude (decimal degrees)
  lon: number;             // Longitude (decimal degrees, negative for west)
  elevation_m: number;     // Elevation in meters
  obs_times: ObsTime[];    // Available observation times
  first_year: number;      // First year of data availability
  last_year: number;       // Last year of data (current year if active)
  active: boolean;         // Currently operational
}

export type ObsTime = '00Z' | '12Z' | '06Z' | '18Z';

// ============================================================================
// Aircraft/ACARS Types
// ============================================================================

export interface AircraftAirport {
  icao: string;            // ICAO airport code (e.g., "KORD")
  iata?: string;           // IATA code (e.g., "ORD")
  name: string;            // Airport name
  city: string;            // City name
  state: string;           // State abbreviation
  lat: number;
  lon: number;
  elevation_ft: number;
  typical_density: 'high' | 'medium' | 'low';  // Expected ACARS density
}

export interface AircraftObs {
  id: string;              // Unique observation ID
  tail_number?: string;    // Aircraft tail number (if available)
  flight_id?: string;      // Flight identifier (e.g., "UAL123")
  obs_time: string;        // ISO 8601 datetime
  lat: number;
  lon: number;
  altitude_ft: number;     // Pressure altitude (feet)
  pressure_mb: number;     // Atmospheric pressure (millibars)
  temp_c: number;          // Temperature (Celsius)
  dewpoint_c?: number;     // Dewpoint if available
  wind_dir_deg: number;    // Wind direction (degrees true)
  wind_speed_kt: number;   // Wind speed (knots)
  phase: 'ascent' | 'descent' | 'cruise' | 'unknown';
  quality_flag?: number;   // MADIS quality control flag
}

export interface AircraftProfile {
  airport_icao: string;
  profile_id: string;      // Unique profile identifier
  profile_time: string;    // Nominal profile time (ISO 8601)
  flight_id?: string;
  phase: 'ascent' | 'descent';
  observations: AircraftObs[];  // Sorted by altitude
  derived?: DerivedParameters;
}

// ============================================================================
// Sounding Data Types
// ============================================================================

export interface SoundingLevel {
  pressure_mb: number;     // Pressure (millibars/hPa)
  height_m: number;        // Geopotential height (meters MSL)
  height_agl_m?: number;   // Height above ground level (meters)
  temp_c: number;          // Temperature (Celsius)
  dewpoint_c: number;      // Dewpoint (Celsius)
  rh?: number;             // Relative humidity (%)
  wind_dir_deg: number;    // Wind direction (degrees true)
  wind_speed_kt: number;   // Wind speed (knots)
  // Derived thermodynamic values
  mixing_ratio_gkg?: number;   // Mixing ratio (g/kg)
  theta_k?: number;            // Potential temperature (Kelvin)
  theta_e_k?: number;          // Equivalent potential temperature (Kelvin)
  wetbulb_c?: number;          // Wet bulb temperature (Celsius)
  virtual_temp_c?: number;     // Virtual temperature (Celsius)
}

export interface SurfaceObs {
  pressure_mb: number;
  temp_c: number;
  dewpoint_c: number;
  rh?: number;
  wind_dir_deg: number;
  wind_speed_kt: number;
  altimeter_inhg?: number;
  visibility_mi?: number;
  weather?: string;        // Present weather codes
}

export interface Sounding {
  station_id: string;
  station_name: string;
  wmo_id?: string;
  lat: number;
  lon: number;
  elevation_m: number;
  obs_time: string;        // ISO 8601 datetime
  obs_time_z: ObsTime;     // Synoptic time (00Z, 12Z, etc.)
  source: SoundingSource;
  levels: SoundingLevel[];
  surface?: SurfaceObs;
  tropopause?: {
    pressure_mb: number;
    height_m: number;
    temp_c: number;
  };
  max_wind?: {
    pressure_mb: number;
    height_m: number;
    wind_dir_deg: number;
    wind_speed_kt: number;
  };
}

export type SoundingSource = 'igra' | 'uwyo' | 'acars';

// ============================================================================
// Derived Parameters Types
// ============================================================================

export interface DerivedParameters {
  station_id: string;
  obs_time: string;

  // Instability indices
  cape_jkg: number;        // Convective Available Potential Energy (J/kg)
  cin_jkg: number;         // Convective Inhibition (J/kg) - negative value
  sbcape: number;          // Surface-based CAPE
  sbcin: number;           // Surface-based CIN
  mlcape: number;          // Mixed-layer CAPE (lowest 100mb)
  mlcin: number;           // Mixed-layer CIN
  mucape: number;          // Most Unstable CAPE (max theta-e in lowest 300mb)
  mucin: number;           // Most Unstable CIN

  // Lifted Index variants
  li: number;              // Lifted Index (500mb)
  li_700: number;          // Lifted Index to 700mb

  // Moisture parameters
  pwat_mm: number;         // Precipitable Water (mm)
  pwat_in: number;         // Precipitable Water (inches)
  mean_rh_0_6km: number;   // Mean RH in 0-6km layer (%)

  // Significant levels (meters AGL)
  lcl_m: number;           // Lifted Condensation Level
  lcl_pressure_mb: number;
  lfc_m: number;           // Level of Free Convection
  lfc_pressure_mb: number;
  el_m: number;            // Equilibrium Level
  el_pressure_mb: number;
  ccl_m?: number;          // Convective Condensation Level

  // Temperature parameters
  t_0c_height_m: number;   // Freezing level (0C isotherm height AGL)
  t_minus10c_height_m: number;  // -10C level height AGL
  t_minus20c_height_m: number;  // -20C level height AGL
  wet_bulb_zero_m: number;      // Wet bulb zero height AGL

  // Wind shear parameters (knots)
  shear_0_500m: number;    // 0-500m bulk shear magnitude
  shear_0_1km: number;     // 0-1km bulk shear magnitude
  shear_0_3km: number;     // 0-3km bulk shear magnitude
  shear_0_6km: number;     // 0-6km bulk shear magnitude
  shear_0_8km: number;     // 0-8km bulk shear magnitude

  // Shear vectors (for hodograph display)
  shear_0_1km_u: number;   // U-component
  shear_0_1km_v: number;   // V-component
  shear_0_6km_u: number;
  shear_0_6km_v: number;

  // Storm-relative parameters (m2/s2)
  srh_0_500m: number;      // 0-500m Storm-Relative Helicity
  srh_0_1km: number;       // 0-1km SRH
  srh_0_3km: number;       // 0-3km SRH

  // Storm motion (Bunkers method)
  storm_motion_right_dir: number;  // Right-mover direction (degrees)
  storm_motion_right_spd: number;  // Right-mover speed (knots)
  storm_motion_left_dir: number;   // Left-mover direction
  storm_motion_left_spd: number;   // Left-mover speed
  storm_motion_mean_dir: number;   // Mean wind direction (0-6km)
  storm_motion_mean_spd: number;   // Mean wind speed (0-6km)

  // Composite indices
  stp: number;             // Significant Tornado Parameter
  scp: number;             // Supercell Composite Parameter
  ship: number;            // Significant Hail Parameter
  ehi_0_1km: number;       // Energy-Helicity Index (0-1km)
  ehi_0_3km: number;       // Energy-Helicity Index (0-3km)

  // Additional severe weather parameters
  k_index: number;
  totals_totals: number;
  sweat_index: number;
  dcape?: number;          // Downdraft CAPE (if calculable)

  // Critical angle
  critical_angle?: number; // Angle between 0-500m shear and storm motion
}

// ============================================================================
// Inventory Types
// ============================================================================

export interface StationInventoryDate {
  date: string;            // YYYY-MM-DD
  times: ObsTime[];        // Available observation times
  sources: SoundingSource[];
}

export interface StationInventory {
  station_id: string;
  station_name: string;
  available: StationInventoryDate[];
  range: {
    earliest: string;      // YYYY-MM-DD
    latest: string;        // YYYY-MM-DD
  };
  last_updated: string;    // ISO 8601
}

// ============================================================================
// API Response Types
// ============================================================================

export interface StationsResponse {
  raob_stations: RAOBStation[];
  acars_airports: AircraftAirport[];
  last_updated: string;
}

export interface InventoryResponse {
  station_id: string;
  station_name: string;
  year: number;
  month: number;
  available: StationInventoryDate[];
  range: {
    earliest: string;
    latest: string;
  };
}

export interface SoundingResponse {
  sounding: Sounding;
  derived: DerivedParameters;
  source: SoundingSource;
  cached: boolean;
  fetched_at: string;
}

export interface ACARSResponse {
  airport: {
    icao: string;
    name: string;
    lat: number;
    lon: number;
  };
  radius_nm: number;
  hours: number;
  observations: AircraftObs[];
  profiles: AircraftProfile[];
  count: number;
  time_range: {
    start: string;
    end: string;
  };
  cached: boolean;
}

// ============================================================================
// Skew-T Rendering Types
// ============================================================================

export interface SkewTConfig {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  pressure_range: [number, number];  // [bottom, top] in mb (e.g., [1050, 100])
  temp_range: [number, number];      // [left, right] in C (e.g., [-40, 50])
  skew_angle: number;                // Skew angle in degrees (typically 45)
  show_dry_adiabats: boolean;
  show_moist_adiabats: boolean;
  show_mixing_ratio: boolean;
  show_wind_barbs: boolean;
  show_cape_cin: boolean;
  show_lcl_lfc_el: boolean;
}

export interface HodographConfig {
  size: number;                      // Width/height in pixels
  max_speed_kt: number;              // Maximum wind speed for scale (e.g., 80)
  ring_interval: number;             // Speed ring interval (e.g., 20)
  show_height_colors: boolean;
  show_srh_shading: boolean;
  show_storm_motion: boolean;
  height_color_levels: number[];     // Heights in meters for color bands
}

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheEntry<T> {
  data: T;
  fetched_at: number;    // Unix timestamp (ms)
  expires_at: number;    // Unix timestamp (ms)
}

export const CACHE_TTL = {
  stations: 24 * 60 * 60 * 1000,           // 24 hours
  inventory_current: 60 * 60 * 1000,       // 1 hour
  inventory_historical: 7 * 24 * 60 * 60 * 1000, // 7 days
  sounding_recent: 30 * 60 * 1000,         // 30 minutes
  sounding_historical: 7 * 24 * 60 * 60 * 1000,  // 7 days
  acars: 15 * 60 * 1000,                   // 15 minutes
} as const;
