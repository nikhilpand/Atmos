// ═══════════════════════════════════════════════════════════════════════
// ATMOS V2.0 — Client-side Stream Extractor
// ═══════════════════════════════════════════════════════════════════════
// Calls /api/extract and manages extraction state with robust error handling.

export interface ExtractedStream {
  type: 'hls' | 'file';
  url: string;
  quality?: string;
  qualities?: Record<string, string>;
  headers?: Record<string, string>;
  captions?: Array<{ language: string; url: string; type: string }>;
  sourceId?: string;
  embedId?: string;
}

export interface ExtractionResult {
  success: boolean;
  stream?: ExtractedStream;
  error?: string;
  fromCache?: boolean;
  extractionTimeMs?: number;
  providersChecked?: number;
}

/**
 * Extract a direct stream URL for a given TMDB title.
 * Returns null if extraction fails — caller should fall back to iframe.
 */
export async function extractStream(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  try {
    const params = new URLSearchParams({ id: tmdbId, type });
    if (season !== undefined) params.set('season', String(season));
    if (episode !== undefined) params.set('episode', String(episode));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18_000); // 18s client timeout

    // Merge abort signals
    const mergedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    const res = await fetch(`/api/extract?${params.toString()}`, {
      signal: mergedSignal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Unknown error' }));
      return {
        success: false,
        error: body.error || `HTTP ${res.status}`,
        providersChecked: body.providersChecked,
      };
    }

    const data: ExtractionResult = await res.json();
    return data;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, error: 'Extraction timed out' };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error during extraction',
    };
  }
}

/**
 * Get the best download URL from an extracted stream.
 * Prefers mp4 file > highest quality HLS.
 */
export function getDownloadUrl(stream: ExtractedStream): { url: string; quality: string; type: 'mp4' | 'hls' } | null {
  if (stream.type === 'file') {
    // Pick highest quality available
    const qualityOrder = ['4k', '1080', '720', '480', '360', 'unknown'] as const;
    for (const q of qualityOrder) {
      const url = stream.qualities?.[q];
      if (url) {
        return { url, quality: q, type: 'mp4' };
      }
    }
    if (stream.url) {
      return { url: stream.url, quality: stream.quality || 'unknown', type: 'mp4' };
    }
  }

  if (stream.type === 'hls' && stream.url) {
    return { url: stream.url, quality: 'auto', type: 'hls' };
  }

  return null;
}
