import WeatherAlerts from '@/components/WeatherAlerts';

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-strong">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Max Velocity Weather</h1>
              <p className="text-xs text-gray-500">Real-time US Weather Intelligence</p>
            </div>
          </div>

          <nav className="hidden sm:flex items-center gap-6">
            <a href="#alerts" className="text-sm text-gray-400 hover:text-white transition-colors">
              Alerts
            </a>
            <a href="#forecast" className="text-sm text-gray-400 hover:text-white transition-colors">
              Forecast
            </a>
            <a href="#map" className="text-sm text-gray-400 hover:text-white transition-colors">
              Map
            </a>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main>
        {/* Hero section */}
        <section className="relative py-16 overflow-hidden">
          {/* Background glow */}
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />

          <div className="max-w-6xl mx-auto px-4 text-center relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-6">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm text-gray-400">System Operational</span>
            </div>

            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4 tracking-tight">
              Weather Intelligence
              <br />
              <span className="text-gradient-cyan">at a Glance</span>
            </h2>

            <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-8">
              Real-time weather alerts ranked by severity and population impact.
              Stay informed with data sourced directly from the National Weather Service.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="#alerts"
                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-cyan-500/25 transition-all duration-200 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                View Active Alerts
              </a>
              <a
                href="/api/alerts"
                target="_blank"
                className="px-6 py-3 glass hover:bg-white/10 text-gray-300 font-medium rounded-xl transition-all duration-200 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                API Endpoint
              </a>
            </div>
          </div>
        </section>

        {/* Alerts section */}
        <section id="alerts">
          <WeatherAlerts />
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-12">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>&copy; {new Date().getFullYear()} Max Velocity Weather</span>
              <span className="hidden sm:inline">|</span>
              <span className="hidden sm:inline">Accurate. Honest. Reliable.</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>Data: National Weather Service</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
