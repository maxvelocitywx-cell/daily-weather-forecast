// Glassmorphism Design System for Weather Forecast Site

export const theme = {
  // Glassmorphism backgrounds
  glass: {
    primary: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 100%)',
    secondary: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(51, 65, 85, 0.85) 100%)',
    card: 'linear-gradient(135deg, rgba(15, 23, 42, 0.8) 0%, rgba(30, 41, 59, 0.7) 100%)',
    cardDark: 'linear-gradient(135deg, rgba(10, 15, 26, 0.9) 0%, rgba(15, 23, 42, 0.85) 100%)',
    overlay: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 50%)',
    overlayStrong: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 40%)',
  },

  // Borders
  border: {
    subtle: '1px solid rgba(255, 255, 255, 0.1)',
    medium: '1px solid rgba(255, 255, 255, 0.15)',
    strong: '1px solid rgba(255, 255, 255, 0.2)',
    accent: (color: string) => `1px solid ${color}33`,
    accentStrong: (color: string) => `1px solid ${color}50`,
  },

  // Shadows
  shadow: {
    xs: '0 2px 8px rgba(0, 0, 0, 0.2)',
    sm: '0 4px 20px rgba(0, 0, 0, 0.3)',
    md: '0 10px 40px rgba(0, 0, 0, 0.4)',
    lg: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    xl: '0 35px 60px -15px rgba(0, 0, 0, 0.6)',
    glow: (color: string) => `0 0 20px ${color}40`,
    glowStrong: (color: string) => `0 0 30px ${color}60`,
    inset: 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
    insetStrong: 'inset 0 1px 0 rgba(255, 255, 255, 0.15)',
  },

  // Colors
  colors: {
    // Base backgrounds
    background: '#0a0f1a',
    backgroundAlt: '#060a12',
    surface: '#0f172a',
    surfaceLight: '#1e293b',
    surfaceLighter: '#334155',

    // Text
    textPrimary: '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
    textMuted: 'rgba(255, 255, 255, 0.4)',
    textDim: 'rgba(255, 255, 255, 0.25)',

    // Accents
    orange: '#fb923c',
    orangeLight: '#fdba74',
    orangeDark: '#ea580c',
    blue: '#3b82f6',
    blueLight: '#60a5fa',
    blueDark: '#2563eb',
    yellow: '#fbbf24',
    yellowLight: '#fde047',
    yellowDark: '#f59e0b',
    purple: '#8b5cf6',
    purpleLight: '#a78bfa',
    purpleDark: '#7c3aed',
    red: '#ef4444',
    redLight: '#f87171',
    redDark: '#dc2626',
    green: '#22c55e',
    greenLight: '#4ade80',
    greenDark: '#16a34a',
    cyan: '#06b6d4',
    cyanLight: '#22d3ee',
    cyanDark: '#0891b2',
    pink: '#ec4899',
    pinkLight: '#f472b6',
    pinkDark: '#db2777',
  },

  // Category colors for weather severity (matching risk scale)
  severity: {
    extreme: { bg: 'rgba(23, 23, 23, 0.2)', border: 'rgba(23, 23, 23, 0.4)', text: '#171717', glow: '#171717' },
    severe: { bg: 'rgba(147, 51, 234, 0.15)', border: 'rgba(147, 51, 234, 0.3)', text: '#a855f7', glow: '#9333ea' },
    major: { bg: 'rgba(185, 28, 28, 0.15)', border: 'rgba(185, 28, 28, 0.3)', text: '#ef4444', glow: '#b91c1c' },
    significant: { bg: 'rgba(220, 38, 38, 0.15)', border: 'rgba(220, 38, 38, 0.3)', text: '#f87171', glow: '#dc2626' },
    high: { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)', text: '#f87171', glow: '#ef4444' },
    elevated: { bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.25)', text: '#fca5a5', glow: '#f87171' },
    active: { bg: 'rgba(251, 146, 60, 0.15)', border: 'rgba(251, 146, 60, 0.3)', text: '#fb923c', glow: '#f97316' },
    marginal: { bg: 'rgba(250, 204, 21, 0.12)', border: 'rgba(250, 204, 21, 0.25)', text: '#fbbf24', glow: '#eab308' },
    quiet: { bg: 'rgba(132, 204, 22, 0.12)', border: 'rgba(132, 204, 22, 0.25)', text: '#a3e635', glow: '#84cc16' },
    veryQuiet: { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.25)', text: '#34d399', glow: '#10b981' },
  },

  // Border radius
  radius: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    '2xl': '32px',
    full: '9999px',
  },

  // Backdrop blur
  blur: {
    xs: 'blur(4px)',
    sm: 'blur(8px)',
    md: 'blur(12px)',
    lg: 'blur(20px)',
    xl: 'blur(30px)',
  },

  // Transitions
  transition: {
    fast: 'all 0.15s ease',
    normal: 'all 0.3s ease',
    slow: 'all 0.5s ease',
    bounce: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },

  // Spacing
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    '2xl': '32px',
    '3xl': '48px',
  },

  // Font sizes
  fontSize: {
    xs: '11px',
    sm: '13px',
    base: '15px',
    lg: '18px',
    xl: '22px',
    '2xl': '28px',
    '3xl': '36px',
  },

  // Font weights
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
};

// Reusable style objects
export const glassCard = {
  background: theme.glass.card,
  backdropFilter: theme.blur.lg,
  WebkitBackdropFilter: theme.blur.lg,
  borderRadius: theme.radius.xl,
  border: theme.border.subtle,
  boxShadow: `${theme.shadow.lg}, ${theme.shadow.inset}`,
  position: 'relative' as const,
  overflow: 'hidden' as const,
};

export const glassCardDark = {
  ...glassCard,
  background: theme.glass.cardDark,
};

export const glassCardCompact = {
  ...glassCard,
  borderRadius: theme.radius.lg,
};

export const glassOverlay = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: theme.glass.overlay,
  pointerEvents: 'none' as const,
  zIndex: 0,
};

export const glassOverlayStrong = {
  ...glassOverlay,
  background: theme.glass.overlayStrong,
};

export const sectionTitle = {
  fontSize: theme.fontSize.xl,
  fontWeight: theme.fontWeight.bold,
  color: theme.colors.textPrimary,
  marginBottom: theme.spacing.xl,
  display: 'flex' as const,
  alignItems: 'center' as const,
  gap: theme.spacing.md,
};

export const sectionTitleCompact = {
  ...sectionTitle,
  fontSize: theme.fontSize.lg,
  marginBottom: theme.spacing.lg,
};

export const badge = (color: string) => ({
  background: `linear-gradient(135deg, ${color}, ${color}cc)`,
  borderRadius: theme.radius.sm,
  padding: '6px 12px',
  fontSize: theme.fontSize.xs,
  fontWeight: theme.fontWeight.semibold,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  color: 'white',
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
});

export const badgeCompact = (color: string) => ({
  ...badge(color),
  padding: '4px 8px',
  fontSize: '10px',
});

export const statCard = (accentColor: string) => ({
  ...glassCard,
  background: `linear-gradient(180deg, ${accentColor}15 0%, ${accentColor}00 100%)`,
  border: `1px solid ${accentColor}33`,
  padding: theme.spacing.xl,
});

export const statCardCompact = (accentColor: string) => ({
  ...statCard(accentColor),
  padding: theme.spacing.lg,
  borderRadius: theme.radius.lg,
});

// Ambient glow effect for page backgrounds
export const ambientGlow = (color: string, position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center') => {
  const positions = {
    'top-left': { top: '-20%', left: '-10%' },
    'top-right': { top: '-20%', right: '-10%' },
    'bottom-left': { bottom: '-20%', left: '-10%' },
    'bottom-right': { bottom: '-20%', right: '-10%' },
    'center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
  };

  return {
    position: 'fixed' as const,
    width: '40%',
    height: '40%',
    background: `radial-gradient(circle, ${color}20 0%, transparent 70%)`,
    pointerEvents: 'none' as const,
    zIndex: 0,
    ...positions[position],
  };
};

// Page container with ambient effects
export const pageContainer = {
  minHeight: '100vh',
  background: `linear-gradient(180deg, ${theme.colors.background} 0%, ${theme.colors.surface} 50%, ${theme.colors.surfaceLight} 100%)`,
  position: 'relative' as const,
};

// Content wrapper
export const contentWrapper = {
  position: 'relative' as const,
  zIndex: 1,
  maxWidth: '1400px',
  margin: '0 auto',
  padding: theme.spacing.xl,
};

// Grid layouts
export const gridAuto = (minWidth = '200px') => ({
  display: 'grid' as const,
  gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}, 1fr))`,
  gap: theme.spacing.lg,
});

export const flexBetween = {
  display: 'flex' as const,
  justifyContent: 'space-between' as const,
  alignItems: 'center' as const,
};

export const flexCenter = {
  display: 'flex' as const,
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
};

export const flexColumn = {
  display: 'flex' as const,
  flexDirection: 'column' as const,
};

// Hover effects
export const hoverLift = {
  transition: theme.transition.normal,
  cursor: 'pointer' as const,
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: theme.shadow.xl,
  },
};

// Text gradient
export const textGradient = (from: string, to: string) => ({
  background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
});

// Utility function to get severity config by risk score
export function getSeverityByScore(score: number) {
  if (score >= 9.5) return theme.severity.extreme;
  if (score >= 8.5) return theme.severity.severe;
  if (score >= 7.5) return theme.severity.major;
  if (score >= 6.5) return theme.severity.significant;
  if (score >= 5.5) return theme.severity.high;
  if (score >= 4.5) return theme.severity.elevated;
  if (score >= 3.5) return theme.severity.active;
  if (score >= 2.5) return theme.severity.marginal;
  if (score >= 1.5) return theme.severity.quiet;
  return theme.severity.veryQuiet;
}

// Utility function to get color by type
export function getAccentColor(type: 'temperature' | 'precipitation' | 'wind' | 'snow' | 'risk' | 'info') {
  switch (type) {
    case 'temperature': return theme.colors.orange;
    case 'precipitation': return theme.colors.blue;
    case 'wind': return theme.colors.yellow;
    case 'snow': return theme.colors.cyan;
    case 'risk': return theme.colors.red;
    case 'info': return theme.colors.purple;
    default: return theme.colors.blue;
  }
}

export default theme;
