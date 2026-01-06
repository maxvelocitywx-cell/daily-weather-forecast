# Max Velocity Weather Dashboard - Product Specification

## Overview

A professional weather intelligence platform providing real-time US weather synopsis, regional forecasts, and risk assessments. Built for Next.js (App Router) with Tailwind CSS and TypeScript.

**Brand Identity:** Max Velocity - Speed meets precision in weather intelligence.

---

## Design Philosophy

### Visual Inspiration
Drawing from modern weather dashboard patterns (dark themes, strong hierarchy, interactive cards), while establishing a unique Max Velocity brand identity:

- **Dark, immersive theme** with gradient backgrounds
- **High contrast** for readability in any lighting
- **Glassmorphism accents** with subtle transparency
- **Color-coded risk visualization** as a core UX element
- **Smooth microinteractions** for engagement

### Key Differentiators
1. **Max Velocity Risk Score (1-10)** - Proprietary risk assessment with detailed thresholds
2. **7 US Regions** - Pacific NW, Southwest, Rockies/High Plains, Central Plains, Midwest, South, Northeast
3. **Per-Day Risk Scoring** - Individual risk scores for each forecast day
4. **Risk Trend History** - 1h, 3h, 6h, 12h, 24h change tracking
5. **Live Coverage Indicators** - When risk warrants broadcast coverage

---

## Page Wireframe (Top-to-Bottom)

```
┌─────────────────────────────────────────────────────────────────────┐
│                           HEADER                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  [Max Velocity Logo]     U.S. Weather Intelligence          │    │
│  │  "Real-time weather risk assessment"                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    NATIONAL OVERVIEW PANEL                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ [Updated Badge]                    [National Risk: X.XX] ←hover │ │
│  │                                          ↓ tooltip            │   │
│  │                               ┌──────────────────────┐         │   │
│  │                               │ Risk Trend History   │         │   │
│  │                               │ 1h ago:  +0.25       │         │   │
│  │                               │ 3h ago:  -0.10       │         │   │
│  │                               │ 6h ago:  No change   │         │   │
│  │                               │ 12h ago: +1.20       │         │   │
│  │                               │ 24h ago: -0.50       │         │   │
│  │                               └──────────────────────┘         │   │
│  │ ┌────────────────────────────────────────────────────────┐    │   │
│  │ │  Paragraph 1: Lead story with high-impact weather       │    │   │
│  │ │  Paragraph 2: Secondary weather stories                 │    │   │
│  │ │  Paragraph 3: Quieter regions and patterns              │    │   │
│  │ └────────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     REGION QUICK NAV (Optional)                     │
│  [Pacific NW] [Southwest] [Rockies] [Central] [Midwest] [South] [NE]│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     REGIONAL FORECASTS SECTION                      │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ Section Title: "Regional Forecasts"                         │     │
│  │ [Updated timestamp badge]                                    │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ PACIFIC NORTHWEST│  │    SOUTHWEST     │  │ ROCKIES/HIGH PLNS│   │
│  │ ═══════════════ │  │ ═══════════════ │  │ ═══════════════ │   │
│  │ [Risk Badge 4.2] │  │ [Risk Badge 2.1] │  │ [Risk Badge 5.8] │   │
│  │ Pattern callout  │  │ Pattern callout  │  │ Pattern callout  │   │
│  │ ───────────────  │  │ ───────────────  │  │ ───────────────  │   │
│  │ [Day1][Day2][D3] │  │ [Day1][Day2][D3] │  │ [Day1][Day2][D3] │   │
│  │ [Days 4-7]       │  │ [Days 4-7]       │  │ [Days 4-7]       │   │
│  │ ───────────────  │  │ ───────────────  │  │ ───────────────  │   │
│  │ Day Risk: 4.2    │  │ Day Risk: 2.1    │  │ Day Risk: 5.8    │   │
│  │                  │  │                  │  │                  │   │
│  │ Forecast text... │  │ Forecast text... │  │ Forecast text... │   │
│  │                  │  │                  │  │                  │   │
│  │ [Risk Reason]    │  │ [Risk Reason]    │  │ [Risk Reason]    │   │
│  │                  │  │                  │  │                  │   │
│  │ → Highlight 1    │  │ → Highlight 1    │  │ → Highlight 1    │   │
│  │ → Highlight 2    │  │ → Highlight 2    │  │ → Highlight 2    │   │
│  │ → Highlight 3    │  │ → Highlight 3    │  │ → Highlight 3    │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │  CENTRAL PLAINS  │  │     MIDWEST      │  │      SOUTH       │   │
│  │      ...         │  │       ...        │  │       ...        │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
│                                                                      │
│  ┌──────────────────┐                                               │
│  │    NORTHEAST     │                                               │
│  │       ...        │                                               │
│  └──────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    MAX VELOCITY RISK SCALE                          │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ Title: "Max Velocity Risk Scale"                            │     │
│  │ Subtitle: "A 1-10 scale measuring impact, coverage, conf."  │     │
│  │ ─────────────────────────────────────────────────────────── │     │
│  │                                                              │     │
│  │ [1][2][3][4][5][6][7][8][9][10] ← Color-coded segmented bar │     │
│  │                                                              │     │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │     │
│  │ │ 1 Quiet  │ │ 2 Calm   │ │ 3 Margin │ │ 4 Active │         │     │
│  │ │ desc...  │ │ desc...  │ │ desc...  │ │ desc...  │         │     │
│  │ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │     │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │     │
│  │ │ 5 Elevat │ │ 6 High   │ │ 7 Signif │ │ 8 Major  │         │     │
│  │ │ desc...  │ │ desc...  │ │ desc...  │ │ desc...  │         │     │
│  │ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │     │
│  │ ┌──────────┐ ┌──────────┐                                    │     │
│  │ │ 9 Severe │ │ 10 Extrm │                                    │     │
│  │ │ desc...  │ │ desc...  │                                    │     │
│  │ └──────────┘ └──────────┘                                    │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      REGION DEFINITIONS                             │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐      │     │
│  │ │ Pacific NW    │ │ Southwest     │ │ Rockies       │      │     │
│  │ │ WA, OR, ID... │ │ CA, NV, AZ... │ │ CO, WY, MT... │      │     │
│  │ └───────────────┘ └───────────────┘ └───────────────┘      │     │
│  │ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐      │     │
│  │ │ Central Plains│ │ Midwest       │ │ South         │      │     │
│  │ │ TX, OK, KS... │ │ IL, OH, MI... │ │ FL, GA, AL... │      │     │
│  │ └───────────────┘ └───────────────┘ └───────────────┘      │     │
│  │ ┌───────────────┐                                          │      │
│  │ │ Northeast     │                                          │      │
│  │ │ NY, PA, MA... │                                          │      │
│  │ └───────────────┘                                          │      │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          DATA SOURCES                               │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ Model Data: HRRR (Day 1), ECMWF (Days 2-7) via Open-Meteo  │     │
│  │ Risk Algorithm: Max Velocity proprietary scoring           │     │
│  │ Updates: Every 3 hours                                      │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                           FOOTER                                    │
│  Data updates automatically every 3 hours                           │
│  © 2025 Max Velocity Weather                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Inventory

### 1. Layout Components

#### `<PageLayout>`
**Purpose:** Root layout wrapper with gradient background
```typescript
interface PageLayoutProps {
  children: React.ReactNode;
}
```
**Features:**
- Fixed gradient background
- Max-width container (1200px)
- Responsive padding

---

#### `<Header>`
**Purpose:** Site branding and navigation
```typescript
interface HeaderProps {
  title: string;           // "U.S. Weather Intelligence"
  subtitle: string;        // "Real-time weather risk assessment"
  logoSrc?: string;        // Optional logo image
}
```
**Features:**
- Centered layout
- Logo display
- Subtitle text

---

### 2. National Overview Components

#### `<NationalOverviewCard>`
**Purpose:** Primary synopsis panel with national risk
```typescript
interface NationalOverviewCardProps {
  updatedAt: string;           // ISO timestamp
  nationalRisk: number;        // 1.00 - 10.00
  paragraphs: string[];        // 2-3 synopsis paragraphs
  riskHistory?: RiskHistory;   // Optional trend data
  isLoading?: boolean;
}

interface RiskHistory {
  '1h': { change: number | null };
  '3h': { change: number | null };
  '6h': { change: number | null };
  '12h': { change: number | null };
  '24h': { change: number | null };
}
```
**Features:**
- Gradient top border (blue → purple → pink)
- Updated timestamp badge
- National risk badge with hover tooltip
- Multi-paragraph synopsis content
- Loading skeleton state

---

#### `<RiskBadge>`
**Purpose:** Displays risk score with color coding
```typescript
interface RiskBadgeProps {
  risk: number;              // 1.00 - 10.00
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;       // Show "Elevated", "High", etc.
  showTooltip?: boolean;     // Enable trend tooltip
  riskHistory?: RiskHistory;
}
```
**Risk Level Mappings:**
| Score | Label | Color Class |
|-------|-------|-------------|
| 1.0-1.9 | Very Quiet | `risk-low` (green) |
| 2.0-2.9 | Quiet | `risk-low` (lime) |
| 3.0-3.9 | Marginal | `risk-moderate` (yellow) |
| 4.0-4.9 | Active | `risk-elevated` (orange) |
| 5.0-5.9 | Elevated | `risk-elevated` (orange) |
| 6.0-6.9 | High | `risk-high` (red) |
| 7.0-7.9 | Significant | `risk-high` (dark red) |
| 8.0-8.9 | Major | `risk-extreme` (maroon) |
| 9.0-9.9 | Severe | `risk-extreme` (purple) |
| 10.0 | Extreme | `risk-extreme` (black/red border) |

---

#### `<RiskHistoryTooltip>`
**Purpose:** Hover tooltip showing risk changes over time
```typescript
interface RiskHistoryTooltipProps {
  history: RiskHistory;
}
```
**Features:**
- Positioned below parent on hover
- Shows 5 time intervals (1h, 3h, 6h, 12h, 24h)
- Color-coded changes: up (red), down (green), same (gray)
- Smooth fade-in animation

---

#### `<UpdatedBadge>`
**Purpose:** Timestamp display
```typescript
interface UpdatedBadgeProps {
  timestamp: string;      // ISO string or formatted
  isLoading?: boolean;
  icon?: 'clock' | 'refresh';
}
```
**Features:**
- Pill-shaped badge
- Blue border and text
- Clock icon prefix
- Loading state

---

### 3. Regional Forecast Components

#### `<RegionalForecastsSection>`
**Purpose:** Container for all region cards
```typescript
interface RegionalForecastsSectionProps {
  regions: RegionData[];
  dayLabels: { day1: string; day2: string; day3: string };
  updatedAt: string;
  isLoading?: boolean;
}
```
**Features:**
- Section title
- Updated badge
- Responsive grid layout (auto-fit, min 340px)

---

#### `<RegionCard>`
**Purpose:** Individual region forecast display
```typescript
interface RegionCardProps {
  id: string;                    // "pacific_nw", "southwest", etc.
  name: string;                  // "Pacific Northwest"
  patternCallout?: string;       // "Active northern jet"
  riskScale: number;             // Overall risk 1-10
  dayRisks: {
    day1: number;
    day2: number;
    day3: number;
  };
  dayRiskReasons: {
    day1?: string;
    day2?: string;
    day3?: string;
  };
  days: {
    day1: string;
    day2: string;
    day3: string;
  };
  longRange: string;             // Days 4-7 outlook
  dayHighlights: {
    day1: string[];
    day2: string[];
    day3: string[];
  };
  dayLabels: {
    day1: string;                // "Monday"
    day2: string;                // "Tuesday"
    day3: string;                // "Wednesday"
  };
  impacts?: string[];            // ["Travel", "Winter"]
}
```
**Features:**
- Risk-colored top border
- Day tab navigation
- Per-day risk badge
- Forecast text panel
- Risk reason callout
- Highlights list
- Hover lift effect

---

#### `<DayTabs>`
**Purpose:** Tab navigation for forecast days
```typescript
interface DayTabsProps {
  labels: { day1: string; day2: string; day3: string };
  activeDay: 'day1' | 'day2' | 'day3' | 'long_range';
  onDayChange: (day: string) => void;
}
```
**Features:**
- Four tabs: Day 1, Day 2, Day 3, Days 4-7
- Active state highlight (blue)
- Click handlers

---

#### `<RiskReason>`
**Purpose:** Explanation callout for risk level
```typescript
interface RiskReasonProps {
  reason: string;
}
```
**Features:**
- Left border accent (blue)
- Italic text
- Dark background

---

#### `<HighlightsList>`
**Purpose:** Bulleted key takeaways
```typescript
interface HighlightsListProps {
  highlights: string[];
}
```
**Features:**
- Arrow prefix icons
- Muted text color
- Top border separator

---

### 4. Risk Scale Components

#### `<RiskScaleSection>`
**Purpose:** Visual risk scale reference
```typescript
interface RiskScaleSectionProps {
  // Static content - no props needed
}
```
**Sub-components:**
- `<RiskScaleBar>` - Segmented 1-10 color bar
- `<RiskLevelGrid>` - Grid of level descriptions

---

#### `<RiskScaleBar>`
**Purpose:** Horizontal segmented bar visualization
```typescript
// Static component
```
**Features:**
- 10 equal segments
- Gradient backgrounds per level
- Hover scale effect
- Numbers centered

---

#### `<RiskLevelCard>`
**Purpose:** Individual risk level description
```typescript
interface RiskLevelCardProps {
  level: number;           // 1-10
  name: string;            // "Very Quiet", "Quiet", etc.
  description: string;
}
```
**Features:**
- Colored number badge
- Level name
- Description text
- Dark card background

---

### 5. Region Reference Components

#### `<RegionDefinitions>`
**Purpose:** Maps regions to states
```typescript
interface RegionDefinitionsProps {
  regions: Array<{
    name: string;
    states: string[];
  }>;
}
```
**Features:**
- Grid layout
- Left border accent
- Region name + states list

---

### 6. Data Sources Component

#### `<DataSourcesPanel>`
**Purpose:** Attribution and methodology
```typescript
interface DataSourcesPanelProps {
  models: string[];        // ["HRRR", "ECMWF"]
  provider: string;        // "Open-Meteo"
  updateInterval: string;  // "3 hours"
}
```
**Features:**
- Compact card
- Model attribution
- Update frequency

---

### 7. Footer Component

#### `<Footer>`
**Purpose:** Site footer
```typescript
interface FooterProps {
  updateInterval?: string;
  copyright?: string;
}
```
**Features:**
- Centered text
- Muted color
- Links

---

### 8. Utility Components

#### `<LoadingSkeleton>`
**Purpose:** Loading placeholder
```typescript
interface LoadingSkeletonProps {
  variant: 'card' | 'text' | 'badge';
  width?: string;
  height?: string;
}
```

---

#### `<ErrorState>`
**Purpose:** Error display
```typescript
interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}
```

---

## Interaction Notes

### 1. Day Tab Switching
- **Trigger:** Click on day tab
- **Animation:** Instant tab highlight change
- **Updates:**
  - Forecast text content
  - Day risk badge (score + color)
  - Header risk badge (score + color)
  - Card border color
  - Risk reason text
  - Highlights list
- **State:** Maintained per-card (not global)

### 2. Risk History Tooltip
- **Trigger:** Hover on national risk badge
- **Animation:** Fade in (0.2s) + translate up
- **Positioning:** Below badge, right-aligned
- **Content:** 5 time intervals with +/- changes
- **Colors:** Up = red (#ef4444), Down = green (#22c55e), Same = gray

### 3. Region Card Hover
- **Trigger:** Hover on region card
- **Animation:** translateY(-4px), enhanced shadow
- **Duration:** 0.2s ease

### 4. Risk Scale Segment Hover
- **Trigger:** Hover on scale segment
- **Animation:** scaleY(1.1)
- **Z-index:** Elevated to prevent overlap

### 5. Auto-Refresh Behavior
- **Synopsis:** Refresh every 1 hour
- **Regional Forecasts:** Refresh every 3 hours
- **Risk History:** Refresh every 15 minutes
- **Visual:** No loading spinner during refresh (smooth update)

### 6. Region Quick Nav (Optional)
- **Behavior:** Smooth scroll to region card
- **Highlight:** Active region in nav

### 7. Loading States
- **Initial Load:** Skeleton placeholders
- **Text:** Pulsing gray background
- **Badges:** "Loading..." text
- **Cards:** Centered loading message

### 8. Error States
- **Synopsis:** "Synopsis temporarily unavailable. Please check back later."
- **Regions:** "Regional forecasts temporarily unavailable."
- **Style:** Red italic text, centered

---

## Design Tokens

### Colors

```typescript
const colors = {
  // Background
  bgPrimary: '#0f172a',        // slate-900
  bgSecondary: '#1e293b',      // slate-800
  bgCard: 'rgba(30, 41, 59, 0.8)', // semi-transparent
  bgCardHover: 'rgba(30, 41, 59, 0.9)',

  // Text
  textPrimary: '#f1f5f9',      // slate-100
  textSecondary: '#cbd5e1',    // slate-300
  textMuted: '#94a3b8',        // slate-400
  textDimmed: '#64748b',       // slate-500

  // Accent
  accentBlue: '#3b82f6',       // blue-500
  accentBlueLight: '#60a5fa',  // blue-400
  accentPurple: '#8b5cf6',     // violet-500
  accentPink: '#ec4899',       // pink-500

  // Risk Colors
  riskLow: '#22c55e',          // green-500
  riskLowAlt: '#84cc16',       // lime-500
  riskModerate: '#eab308',     // yellow-500
  riskElevated: '#f97316',     // orange-500
  riskHigh: '#ef4444',         // red-500
  riskHighAlt: '#dc2626',      // red-600
  riskExtreme: '#b91c1c',      // red-700
  riskSevere: '#581c87',       // purple-800
  riskHistoric: '#000000',     // black

  // Status
  error: '#f87171',            // red-400
  success: '#22c55e',          // green-500

  // Borders
  borderSubtle: 'rgba(148, 163, 184, 0.1)',
  borderMedium: 'rgba(148, 163, 184, 0.2)',
  borderAccent: 'rgba(59, 130, 246, 0.3)',
};
```

### Spacing

```typescript
const spacing = {
  // Base: 4px
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',

  // Semantic
  cardPadding: '24px',         // 6
  cardPaddingLg: '40px',       // 10
  sectionGap: '40px',          // 10
  gridGap: '24px',             // 6
  containerPadding: '20px',    // 5
};
```

### Border Radius

```typescript
const borderRadius = {
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  full: '100px',               // pill shape
};
```

### Typography

```typescript
const typography = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",

  // Font Sizes
  xs: '0.75rem',    // 12px
  sm: '0.85rem',    // 13.6px
  base: '0.95rem',  // 15.2px
  md: '1rem',       // 16px
  lg: '1.1rem',     // 17.6px
  xl: '1.25rem',    // 20px
  '2xl': '1.5rem',  // 24px
  '3xl': '2.2rem',  // 35.2px

  // Font Weights
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',

  // Line Heights
  tight: '1.2',
  normal: '1.5',
  relaxed: '1.7',
  loose: '1.8',

  // Letter Spacing
  tight: '-0.5px',
  normal: '0',
  wide: '0.5px',
  wider: '1px',
};
```

### Shadows

```typescript
const shadows = {
  sm: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
  md: '0 4px 20px rgba(0, 0, 0, 0.3)',
  lg: '0 10px 40px -10px rgba(0, 0, 0, 0.5)',
  xl: '0 8px 30px rgba(0, 0, 0, 0.4)',

  // Combined for cards
  card: `
    0 4px 6px -1px rgba(0, 0, 0, 0.3),
    0 10px 40px -10px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.05)
  `,
  cardHover: '0 8px 30px rgba(0, 0, 0, 0.4)',
};
```

### Transitions

```typescript
const transitions = {
  fast: '0.1s ease',
  normal: '0.2s ease',
  slow: '0.3s ease',

  // Specific
  hover: 'transform 0.2s ease, box-shadow 0.2s ease',
  tooltip: 'all 0.2s ease',
};
```

### Breakpoints

```typescript
const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1200px',
  '2xl': '1400px',
};
```

### Z-Index Scale

```typescript
const zIndex = {
  base: 1,
  card: 10,
  tooltip: 100,
  modal: 1000,
  toast: 2000,
};
```

---

## 7-Region Definitions

| Region ID | Display Name | States |
|-----------|--------------|--------|
| `pacific_nw` | Pacific Northwest | Washington, Oregon, Idaho |
| `southwest` | Southwest | California, Nevada, Arizona, Utah, New Mexico |
| `rockies` | Rockies / High Plains | Colorado, Wyoming, Montana |
| `central_plains` | Central Plains | Texas, Oklahoma, Kansas, Nebraska, North Dakota, South Dakota |
| `midwest` | Midwest | Minnesota, Iowa, Missouri, Illinois, Indiana, Ohio, Michigan, Wisconsin |
| `south` | South | Louisiana, Arkansas, Mississippi, Alabama, Georgia, Florida, Tennessee, Kentucky, South Carolina, North Carolina |
| `northeast` | Northeast | Virginia, West Virginia, Maryland, Delaware, DC, Pennsylvania, New Jersey, New York, Connecticut, Rhode Island, Massachusetts, Vermont, New Hampshire, Maine |

---

## Max Velocity Risk Scale - Thresholds & Wording

| Level | Name | Score Range | Description |
|-------|------|-------------|-------------|
| 1 | Very Quiet | 1.0 - 1.9 | Little to no impactful weather expected. Conditions are typical for the season, with minimal disruptions and no hazards affecting daily activities. |
| 2 | Quiet | 2.0 - 2.9 | Mostly calm weather conditions. Minor, isolated nuisances possible, but no meaningful impacts anticipated across the region. |
| 3 | Marginal | 3.0 - 3.9 | Noticeable weather features present. Brief or localized disruptions possible, especially for outdoor plans, but overall impacts remain limited. |
| 4 | Active | 4.0 - 4.9 | Active weather pattern developing. Some travel or outdoor disruptions likely in parts of the region. Live coverage may be warranted if conditions escalate. |
| 5 | Elevated | 5.0 - 5.9 | Widespread active weather with increasing impacts. Travel disruptions likely in multiple areas. Live coverage possible as conditions evolve. |
| 6 | High | 6.0 - 6.9 | High-impact weather expected in portions of the region. Hazardous travel possible. Live coverage likely as confidence and impacts increase. |
| 7 | Significant | 7.0 - 7.9 | Significant weather event with high confidence in impacts. Dangerous conditions likely in affected areas. Live coverage is likely if impacts are widespread. |
| 8 | Major | 8.0 - 8.9 | Major, high-impact weather event underway or imminent. High confidence in widespread disruptions. Travel strongly discouraged in impacted areas. Live stream coverage is expected. |
| 9 | Severe | 9.0 - 9.9 | Severe, high-end weather event with very high confidence. Potential for major damage, prolonged disruptions, and dangerous conditions across large areas. Extensive live stream coverage is expected. |
| 10 | Extreme | 10.0 | Rare or historic weather event with exceptionally high confidence. Extreme impacts likely. Life safety actions may be required in affected locations. Historic live stream coverage is expected. |

---

## API Endpoints

### Synopsis API
```
GET /api/us-synopsis
```
**Response:**
```json
{
  "updated_utc": "2025-01-15T12:00:00Z",
  "paragraphs": ["...", "...", "..."],
  "national_risk": 4.25
}
```

### Regional Forecast API
```
GET /api/synopsis
```
**Response:**
```json
{
  "updated_utc": "2025-01-15T12:00:00Z",
  "day_labels": {
    "day1": "Monday",
    "day2": "Tuesday",
    "day3": "Wednesday"
  },
  "regions": [
    {
      "id": "pacific_nw",
      "name": "Pacific Northwest",
      "risk_scale": 4.2,
      "day_risks": { "day1": 4.2, "day2": 3.8, "day3": 2.5 },
      "day_risk_reasons": { "day1": "...", "day2": "...", "day3": "..." },
      "days": { "day1": "...", "day2": "...", "day3": "..." },
      "long_range": "...",
      "day_highlights": { "day1": ["..."], "day2": ["..."], "day3": ["..."] },
      "pattern_callout": "Active northern jet",
      "impacts": ["Travel", "Winter"]
    }
  ]
}
```

### Risk History API
```
GET /api/risk-history
```
**Response:**
```json
{
  "history": {
    "1h": { "change": 0.25 },
    "3h": { "change": -0.10 },
    "6h": { "change": null },
    "12h": { "change": 1.20 },
    "24h": { "change": -0.50 }
  }
}
```

---

## Mobile Responsiveness

### Breakpoint Behaviors

**Desktop (≥1024px)**
- Full 3-column grid for regions
- All components at full size

**Tablet (768px - 1023px)**
- 2-column grid for regions
- Slight padding reduction

**Mobile (< 768px)**
- Single column layout
- Reduced typography sizes
- Header: 1.8rem → 1.5rem
- Card padding: 24px → 20px
- Synopsis card: 40px → 24px padding
- Border radius: 24px → 16px
- Risk scale bar: May wrap or scroll

### Touch Considerations
- Tab buttons: Minimum 44px touch target
- Tooltips: Tap-to-show (not hover)
- Cards: No hover effect on mobile

---

## File Structure (Next.js App Router)

```
app/
├── page.tsx                    # Home page
├── layout.tsx                  # Root layout
├── globals.css                 # Global styles + Tailwind
├── api/
│   ├── synopsis/route.ts       # Regional forecasts
│   ├── us-synopsis/route.ts    # National synopsis
│   └── risk-history/route.ts   # Risk trend data
components/
├── layout/
│   ├── Header.tsx
│   ├── Footer.tsx
│   └── PageLayout.tsx
├── national/
│   ├── NationalOverviewCard.tsx
│   ├── RiskBadge.tsx
│   ├── RiskHistoryTooltip.tsx
│   └── UpdatedBadge.tsx
├── regions/
│   ├── RegionalForecastsSection.tsx
│   ├── RegionCard.tsx
│   ├── DayTabs.tsx
│   ├── RiskReason.tsx
│   └── HighlightsList.tsx
├── risk-scale/
│   ├── RiskScaleSection.tsx
│   ├── RiskScaleBar.tsx
│   └── RiskLevelCard.tsx
├── reference/
│   ├── RegionDefinitions.tsx
│   └── DataSourcesPanel.tsx
└── ui/
    ├── LoadingSkeleton.tsx
    └── ErrorState.tsx
lib/
├── api.ts                      # API fetching utilities
├── risk.ts                     # Risk calculation helpers
├── format.ts                   # Date/number formatting
└── constants.ts                # Region definitions, risk thresholds
types/
└── index.ts                    # TypeScript interfaces
```

---

## Implementation Priority

### Phase 1: Core Structure
1. Page layout + header/footer
2. National overview card (static first)
3. Risk badge component
4. Basic region cards (no tabs)

### Phase 2: Interactivity
1. Day tab switching
2. Risk history tooltip
3. Loading/error states
4. Auto-refresh behavior

### Phase 3: Polish
1. Animations and transitions
2. Mobile optimization
3. Accessibility audit
4. Performance optimization

### Phase 4: Enhancement
1. Region quick-nav
2. Keyboard navigation
3. PWA features (offline support)
4. Analytics integration

---

## Data Sources Attribution

All weather data is sourced from:
- **HRRR Model** (Day 1) - High-Resolution Rapid Refresh, NOAA
- **ECMWF Model** (Days 2-7) - European Centre for Medium-Range Weather Forecasts
- **Open-Meteo API** - Weather data aggregation service

Risk scoring is calculated using Max Velocity's proprietary algorithm considering:
- Temperature extremes and wind chill
- Precipitation type and accumulation
- Wind gusts and sustained speeds
- Visibility impacts
- CAPE (convective potential)
- Geographic coverage and confidence

---

*Document Version: 1.0*
*Created: December 2024*
*Brand: Max Velocity Weather*
