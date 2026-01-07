'use client';

import { DataFreshness, DataSourceIndicator } from './DataFreshness';
import { OverlayToggle, OverlayStatus } from './OverlayBadge';
import { useOverlays } from '@/lib/overlays/useOverlays';

interface UpdateBarProps {
  lastUpdated: string | Date | null;
  isLoading?: boolean;
  onRefresh?: () => void;
}

export function UpdateBar({ lastUpdated, isLoading, onRefresh }: UpdateBarProps) {
  const { spcAvailable, eroAvailable, overlaysEnabled, toggleOverlays } = useOverlays();

  return (
    <div className="bg-mv-bg-secondary/80 backdrop-blur-sm border-b border-white/5 sticky top-0 z-30">
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
    <header className="bg-mv-bg-primary border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-mv-accent-blue to-blue-600 flex items-center justify-center">
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
              <h1 className="text-xl font-bold text-mv-text-primary">
                Max Velocity Weather
              </h1>
              <p className="text-xs text-mv-text-muted">
                Weather Intelligence Dashboard
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-4">
            <NavLink href="/" active>
              Dashboard
            </NavLink>
            <NavLink href="/regions">Regions</NavLink>
            <NavLink href="/about">About</NavLink>
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
      className={`text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
        active
          ? 'text-mv-text-primary bg-white/5'
          : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
      }`}
    >
      {children}
    </a>
  );
}

export function Footer() {
  return (
    <footer className="bg-mv-bg-secondary border-t border-white/5 mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="text-sm text-mv-text-muted">
            © {new Date().getFullYear()} Max Velocity Weather. All rights reserved.
          </div>
          <div className="flex items-center gap-4 text-sm text-mv-text-muted">
            <a href="#" className="hover:text-mv-text-primary transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-mv-text-primary transition-colors">
              Terms
            </a>
            <a href="#" className="hover:text-mv-text-primary transition-colors">
              API
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
