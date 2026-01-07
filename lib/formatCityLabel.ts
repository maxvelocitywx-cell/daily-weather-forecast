/**
 * Format city name with state abbreviation
 *
 * Single source of truth for city label formatting.
 * Use this everywhere cities are displayed.
 */

interface CityLike {
  name: string;
  state?: string;
}

/**
 * Format a city object as "City, ST"
 * @param city - Object with name and optional state
 * @returns Formatted string like "Bend, OR" or just "City" if no state
 */
export function formatCityLabel(city: CityLike): string {
  if (!city.state) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[formatCityLabel] City "${city.name}" is missing state abbreviation`);
    }
    return city.name;
  }

  // Ensure state is uppercase 2-letter abbreviation
  const stateAbbr = city.state.length === 2
    ? city.state.toUpperCase()
    : city.state;

  return `${city.name}, ${stateAbbr}`;
}

/**
 * Format city name and state strings as "City, ST"
 * @param name - City name
 * @param state - State abbreviation (optional)
 * @returns Formatted string
 */
export function formatCityNameState(name: string, state?: string): string {
  return formatCityLabel({ name, state });
}
