import { makeProviders, makeStandardFetcher, makeSimpleProxyFetcher, targets } from '@movie-web/providers';

// The proxy URL is our Next.js API route we just created
const PROXY_URL = '/api/proxy';

const providers = makeProviders({
  fetcher: makeSimpleProxyFetcher(
    PROXY_URL,
    fetch
  ),
  target: targets.BROWSER,
});

export interface MediaDetails {
  type: 'movie' | 'tv';
  title: string;
  releaseYear: number;
  tmdbId: string;
  season?: number;
  episode?: number;
}

export async function extractStreamClient(mediaDetails: MediaDetails): Promise<string | null> {
  const media: any = mediaDetails.type === 'movie' 
    ? { 
        type: 'movie', 
        title: mediaDetails.title, 
        releaseYear: mediaDetails.releaseYear, 
        tmdbId: mediaDetails.tmdbId 
      }
    : { 
        type: 'show', 
        title: mediaDetails.title, 
        releaseYear: mediaDetails.releaseYear, 
        tmdbId: mediaDetails.tmdbId, 
        season: { number: mediaDetails.season, tmdbId: '' }, 
        episode: { number: mediaDetails.episode, tmdbId: '' } 
      };

  try {
    const output = await providers.runAll({
      media,
    });

    if (output && output.stream) {
      const stream = Array.isArray(output.stream) ? output.stream[0] : output.stream;
      const streamUrl = (stream as any)?.playlist || (stream as any)?.url || (stream as any)?.qualities?.['auto']?.url || (Object.values((stream as any)?.qualities || {})[0] as any)?.url;
      return streamUrl || null;
    }
  } catch (error) {
    console.error('[MovieWeb Client] Extraction failed:', error);
  }
  
  return null;
}
