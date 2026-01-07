/**
 * Chart export utilities for PNG download and link sharing
 */

// Logo path for watermark
const LOGO_PATH = '/branding/max-velocity-logo.png';
const LOGO_OPACITY = 0.12;

/**
 * Export a chart element to PNG
 * @param element - The DOM element containing the chart (typically an SVG or canvas parent)
 * @param filename - The filename for the download (without extension)
 * @param options - Export options
 */
export async function exportChartToPNG(
  element: HTMLElement | null,
  filename: string,
  options: {
    backgroundColor?: string;
    scale?: number;
    padding?: number;
    includeLogo?: boolean;
  } = {}
): Promise<void> {
  if (!element) {
    console.error('[chartExport] No element provided for export');
    return;
  }

  const { backgroundColor = '#1a1a2e', scale = 2, padding = 16, includeLogo = true } = options;

  try {
    // Find SVG element within the container
    const svg = element.querySelector('svg');
    if (!svg) {
      console.error('[chartExport] No SVG found in element');
      return;
    }

    // Clone SVG to avoid modifying the original
    const clonedSvg = svg.cloneNode(true) as SVGElement;

    // Get SVG dimensions
    const bbox = svg.getBoundingClientRect();
    const width = bbox.width + padding * 2;
    const height = bbox.height + padding * 2;

    // Set explicit dimensions on cloned SVG
    clonedSvg.setAttribute('width', String(bbox.width));
    clonedSvg.setAttribute('height', String(bbox.height));

    // Convert SVG to string
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(clonedSvg);

    // Add XML declaration and namespaces if missing
    if (!svgString.includes('xmlns')) {
      svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // Create a data URL from the SVG
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    // Create canvas for PNG conversion
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.error('[chartExport] Could not get canvas context');
      URL.revokeObjectURL(svgUrl);
      return;
    }

    // Fill background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load SVG as image
    const img = new Image();
    img.onload = async () => {
      // Draw SVG centered with padding
      ctx.drawImage(
        img,
        padding * scale,
        padding * scale,
        bbox.width * scale,
        bbox.height * scale
      );

      // Add logo watermark if enabled
      if (includeLogo) {
        try {
          await drawLogoWatermark(ctx, canvas.width, canvas.height, scale);
        } catch {
          // Logo loading failed, continue without it
          console.warn('[chartExport] Could not load logo watermark');
        }
      }

      // Convert to PNG and download
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            console.error('[chartExport] Failed to create blob');
            return;
          }

          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${filename}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        },
        'image/png',
        1.0
      );

      URL.revokeObjectURL(svgUrl);
    };

    img.onerror = () => {
      console.error('[chartExport] Failed to load SVG as image');
      URL.revokeObjectURL(svgUrl);
    };

    img.src = svgUrl;
  } catch (error) {
    console.error('[chartExport] Export failed:', error);
  }
}

/**
 * Draw logo watermark on canvas
 */
async function drawLogoWatermark(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  scale: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const logo = new Image();
    logo.crossOrigin = 'anonymous';

    logo.onload = () => {
      // Calculate logo size (height ~32px at scale 1)
      const logoHeight = 32 * scale;
      const logoWidth = (logo.width / logo.height) * logoHeight;

      // Position in bottom-right corner with padding
      const x = canvasWidth - logoWidth - (16 * scale);
      const y = canvasHeight - logoHeight - (12 * scale);

      // Draw with transparency
      ctx.globalAlpha = LOGO_OPACITY;
      ctx.drawImage(logo, x, y, logoWidth, logoHeight);
      ctx.globalAlpha = 1.0;

      resolve();
    };

    logo.onerror = () => {
      reject(new Error('Failed to load logo'));
    };

    logo.src = LOGO_PATH;
  });
}

/**
 * Generate a shareable URL with chart state encoded
 * @param baseUrl - The base URL of the page
 * @param state - Chart state to encode
 */
export function generateChartShareUrl(
  baseUrl: string,
  state: {
    cityId?: string;
    regionId?: string;
    day?: number;
    tab?: string;
    compareCityId?: string;
    zoomStart?: number;
    zoomEnd?: number;
    visibleSeries?: string[];
  }
): string {
  const url = new URL(baseUrl);
  const params = url.searchParams;

  if (state.cityId) params.set('city', state.cityId);
  if (state.regionId) params.set('region', state.regionId);
  if (state.day !== undefined) params.set('day', String(state.day));
  if (state.tab) params.set('tab', state.tab);
  if (state.compareCityId) params.set('compare', state.compareCityId);
  if (state.zoomStart !== undefined) params.set('zoomStart', String(state.zoomStart));
  if (state.zoomEnd !== undefined) params.set('zoomEnd', String(state.zoomEnd));
  if (state.visibleSeries && state.visibleSeries.length > 0) {
    params.set('series', state.visibleSeries.join(','));
  }

  return url.toString();
}

/**
 * Parse chart state from URL parameters
 * @param url - The URL to parse
 */
export function parseChartStateFromUrl(url: string): {
  cityId?: string;
  regionId?: string;
  day?: number;
  tab?: string;
  compareCityId?: string;
  zoomStart?: number;
  zoomEnd?: number;
  visibleSeries?: string[];
} {
  const parsedUrl = new URL(url);
  const params = parsedUrl.searchParams;

  return {
    cityId: params.get('city') || undefined,
    regionId: params.get('region') || undefined,
    day: params.has('day') ? parseInt(params.get('day')!, 10) : undefined,
    tab: params.get('tab') || undefined,
    compareCityId: params.get('compare') || undefined,
    zoomStart: params.has('zoomStart') ? parseInt(params.get('zoomStart')!, 10) : undefined,
    zoomEnd: params.has('zoomEnd') ? parseInt(params.get('zoomEnd')!, 10) : undefined,
    visibleSeries: params.has('series') ? params.get('series')!.split(',') : undefined,
  };
}

/**
 * Copy chart share URL to clipboard
 * @param url - The URL to copy
 * @returns Promise that resolves when copied
 */
export async function copyChartUrlToClipboard(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch (error) {
    console.error('[chartExport] Failed to copy URL:', error);
    // Fallback for older browsers
    try {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch {
      return false;
    }
  }
}
