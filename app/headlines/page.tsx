import { Metadata } from 'next';
import HeadlinesList from '@/components/headlines/HeadlinesList';
import { getLatestRun, initializeWithSeedData } from '@/lib/headlines/storage';

export const metadata: Metadata = {
  title: 'Top 10 Weather Headlines — United States | Max Velocity Weather',
  description:
    'Real-time weather headlines across the United States. Updated every 15 minutes with the latest severe weather, winter storms, flooding, and tropical updates.',
  openGraph: {
    title: 'Top 10 Weather Headlines — United States',
    description: 'Real-time weather headlines updated every 15 minutes',
  },
};

export const dynamic = 'force-dynamic';
export const revalidate = 60;

async function getInitialHeadlines() {
  try {
    let run = getLatestRun();

    if (!run) {
      initializeWithSeedData();
      run = getLatestRun();
    }

    return run;
  } catch (error) {
    console.error('Error getting initial headlines:', error);
    return null;
  }
}

export default async function HeadlinesPage() {
  const initialData = await getInitialHeadlines();

  return (
    <div className="min-h-screen bg-mv-bg-primary">
      {/* Hero section */}
      <header className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.1),transparent_50%)]" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
              </span>
              <span className="text-sm font-medium text-cyan-400">Live Updates</span>
            </div>

            {/* Title */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white mb-4 tracking-tight">
              Top 10 Weather Headlines
            </h1>
            <p className="text-xl sm:text-2xl text-gray-400 font-medium mb-2">
              United States
            </p>
            <p className="text-sm text-gray-500 max-w-2xl mx-auto">
              AI-curated headlines from official NWS, SPC, WPC, and NHC data sources.
              Updated every 15 minutes.
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <HeadlinesList initialData={initialData} />
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-center gap-6 text-xs text-gray-600">
            <a
              href="https://www.weather.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-400 transition-colors"
            >
              NWS
            </a>
            <a
              href="https://www.spc.noaa.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-400 transition-colors"
            >
              SPC
            </a>
            <a
              href="https://www.wpc.ncep.noaa.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-400 transition-colors"
            >
              WPC
            </a>
            <a
              href="https://www.nhc.noaa.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-400 transition-colors"
            >
              NHC
            </a>
          </div>
          <p className="text-center text-xs text-gray-700 mt-4">
            Headlines generated using AI with data from official NOAA sources
          </p>
        </div>
      </footer>
    </div>
  );
}
