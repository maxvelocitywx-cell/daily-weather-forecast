// Script to fetch county population data from Census API and generate JSON
// Run with: node scripts/fetch-county-population.js

const fs = require('fs');
const path = require('path');

async function fetchCountyPopulation() {
  console.log('Fetching county population data from Census API...');

  const response = await fetch(
    'https://api.census.gov/data/2020/dec/pl?get=P1_001N,NAME&for=county:*&in=state:*'
  );

  if (!response.ok) {
    throw new Error(`Census API error: ${response.status}`);
  }

  const data = await response.json();

  // First row is headers: ["P1_001N", "NAME", "state", "county"]
  const [headers, ...rows] = data;

  // Build population map keyed by 5-digit FIPS
  const populationMap = {};

  for (const row of rows) {
    const [population, name, stateCode, countyCode] = row;
    const fips = stateCode + countyCode; // 5-digit FIPS
    populationMap[fips] = {
      population: parseInt(population, 10),
      name: name,
      state: stateCode
    };
  }

  console.log(`Processed ${Object.keys(populationMap).length} counties`);

  // Write to data file
  const outputPath = path.join(__dirname, '..', 'data', 'county-population.json');

  // Ensure data directory exists
  const dataDir = path.dirname(outputPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(populationMap, null, 2));
  console.log(`Written to ${outputPath}`);

  // Also create a compact version for production
  const compactPath = path.join(__dirname, '..', 'data', 'county-population.min.json');
  fs.writeFileSync(compactPath, JSON.stringify(populationMap));
  console.log(`Compact version written to ${compactPath}`);
}

fetchCountyPopulation().catch(console.error);
