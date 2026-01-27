'use client';

import { DataFreshness, DataSourceIndicator } from './DataFreshness';
import { OverlayToggle, OverlayStatus } from './OverlayBadge';
import { useOverlays } from '@/lib/overlays/useOverlays';
import { theme } from '@/styles/theme';

interface UpdateBarProps {
  lastUpdated: string | Date | null;
  isLoading?: boolean;
  onRefresh?: () => void;
}

export function UpdateBar({ lastUpdated, isLoading, onRefresh }: UpdateBarProps) {
  const { spcAvailable, eroAvailable, overlaysEnabled, toggleOverlays } = useOverlays();

  return (
    <div
      className="sticky top-0 z-30"
      style={{
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85) 0%, rgba(30, 41, 59, 0.8) 100%)',
        backdropFilter: theme.blur.lg,
        WebkitBackdropFilter: theme.blur.lg,
        borderBottom: theme.border.subtle,
      }}
    >
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <DataFreshness
            lastUpdated={lastUpdated}
            isLoading={isLoading}
            onRefresh={onRefresh}
          />
          <DataSourceIndicator
            sources={[
              { name: 'Open-Meteo', status: 'online' },
              { name: 'SPC', status: spcAvailable ? 'online' : 'offline' },
              { name: 'WPC', status: eroAvailable ? 'online' : 'offline' },
            ]}
          />
        </div>

        <div className="flex items-center gap-4">
          <OverlayStatus spcAvailable={spcAvailable} eroAvailable={eroAvailable} />
          <OverlayToggle
            enabled={overlaysEnabled}
            onToggle={toggleOverlays}
            available={spcAvailable || eroAvailable}
          />
        </div>
      </div>
    </div>
  );
}

export function Header() {
  return (
    <header
      style={{
        background: 'linear-gradient(135deg, rgba(10, 15, 26, 0.95) 0%, rgba(15, 23, 42, 0.9) 100%)',
        backdropFilter: theme.blur.lg,
        WebkitBackdropFilter: theme.blur.lg,
        borderBottom: theme.border.subtle,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle gradient overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, transparent 50%, rgba(139, 92, 246, 0.03) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div className="max-w-7xl mx-auto px-4 py-4 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo with glow effect */}
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: theme.radius.lg,
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 0 20px rgba(59, 130, 246, 0.4), ${theme.shadow.md}`,
                position: 'relative',
              }}
            >
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                />
              </svg>
            </div>
            <div>
              <h1
                style={{
                  fontSize: theme.fontSize.xl,
                  fontWeight: theme.fontWeight.bold,
                  background: 'linear-gradient(135deg, #ffffff 0%, #94a3b8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Max Velocity Weather
              </h1>
              <p
                style={{
                  fontSize: theme.fontSize.xs,
                  color: theme.colors.textMuted,
                  letterSpacing: '0.5px',
                }}
              >
                Weather Intelligence Dashboard
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <NavLink href="/">
              Dashboard
            </NavLink>
            <NavLink href="/wssi-winter">WSSI Severity</NavLink>
            <NavLink href="/wssi-impacts">WSSI Impacts</NavLink>
          </nav>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
  active,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <a
      href={href}
      style={{
        fontSize: theme.fontSize.sm,
        fontWeight: theme.fontWeight.medium,
        padding: '8px 14px',
        borderRadius: theme.radius.md,
        transition: theme.transition.fast,
        color: active ? theme.colors.textPrimary : theme.colors.textMuted,
        background: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
        border: active ? theme.border.subtle : '1px solid transparent',
      }}
      className="hover:text-white hover:bg-white/5"
    >
      {children}
    </a>
  );
}

export function Footer() {
  return (
    <footer
      style={{
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.85) 100%)',
        backdropFilter: theme.blur.md,
        WebkitBackdropFilter: theme.blur.md,
        borderTop: theme.border.subtle,
        marginTop: 'auto',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle top highlight */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
        }}
      />

      <div className="max-w-7xl mx-auto px-4 py-6 relative z-10">
        <div className="flex items-center justify-between">
          <div
            style={{
              fontSize: theme.fontSize.sm,
              color: theme.colors.textMuted,
            }}
          >
            © {new Date().getFullYear()} Max Velocity Weather. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            {['Privacy', 'Terms', 'API'].map((item) => (
              <a
                key={item}
                href="#"
                style={{
                  fontSize: theme.fontSize.sm,
                  color: theme.colors.textMuted,
                  transition: theme.transition.fast,
                }}
                className="hover:text-white"
              >
                {item}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
