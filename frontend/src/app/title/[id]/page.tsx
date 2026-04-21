/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import FrostedNavbar from '@/components/ui/FrostedNavbar';
import TitleHero from '@/components/title/TitleHero';
import SeasonSelector from '@/components/title/SeasonSelector';
import CastCarousel from '@/components/title/CastCarousel';
import SimilarTitles from '@/components/title/SimilarTitles';
import { fetchTitle, type Episode } from '@/lib/api';
import { useMediaStore } from '@/store/useMediaStore';

function TitlePageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const type = (searchParams.get('type') || 'movie') as 'movie' | 'tv';
  const titleHint = searchParams.get('title') || undefined;
  
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);

  // Fetch title detail
  const { data, isLoading, error } = useQuery({
    queryKey: ['title', id, type],
    queryFn: () => fetchTitle(id, type, titleHint),
    enabled: !!id,
    staleTime: 24 * 60 * 60 * 1000,
  });

  // Fetch episodes when season changes (for TV shows)
  // Routes through server-side /api/title to protect TMDB key
  useEffect(() => {
    if (type !== 'tv' || !id) return;

    const fetchEpisodes = async () => {
      setIsLoadingEpisodes(true);
      try {
        // Use server-side API route (protects TMDB key)
        const res = await fetch(`/api/title?id=${id}&type=tv&season=${selectedSeason}`);
        if (res.ok) {
          const seasonData = await res.json();
          if (seasonData.episodes && seasonData.episodes.length > 0) {
            setEpisodes(seasonData.episodes);
            return;
          }
        }

        // Fallback: generate episode list from season metadata
        const seasonInfo = data?.seasons?.find(
          (s: any) => s.season_number === selectedSeason
        );
        const epCount = seasonInfo?.episode_count || 10;
        const titleStr = data?.detail?.title || data?.detail?.name || '';
        setEpisodes(
          Array.from({ length: epCount }, (_, i) => ({
            id: i + 1,
            episode_number: i + 1,
            season_number: selectedSeason,
            name: `Episode ${i + 1}`,
            overview: `${titleStr} — Season ${selectedSeason}, Episode ${i + 1}`,
            still_path: undefined,
            air_date: undefined,
            runtime: undefined,
            vote_average: undefined,
          }))
        );
      } catch {
        setEpisodes([]);
      } finally {
        setIsLoadingEpisodes(false);
      }
    };

    fetchEpisodes();
  }, [id, type, selectedSeason, data]);

  // Dynamic SEO title — must be before any early returns (Rules of Hooks)
  const titleName = data?.detail?.title || data?.detail?.name || titleHint || 'ATMOS';
  useEffect(() => {
    document.title = `${titleName} | ATMOS`;
  }, [titleName]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen">
        <FrostedNavbar />
        <div className="w-full h-[70vh] shimmer" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
          <div className="h-6 w-32 rounded shimmer" />
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-24 space-y-2">
                <div className="w-20 h-20 mx-auto rounded-full shimmer" />
                <div className="h-3 w-full rounded shimmer" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data || !data.detail) {
    return (
      <div className="min-h-screen">
        <FrostedNavbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <p className="text-white/50 text-lg">Title not found</p>
            <p className="text-white/30 text-sm mt-1">This title may not be available</p>
          </div>
        </div>
      </div>
    );
  }

  const { detail, cast, similar, videos, seasons } = data;

  // Find YouTube trailer
  const trailer = videos?.find(v => v.type === 'Trailer') || videos?.[0];

  return (
    <div className="min-h-screen pb-20">
      <FrostedNavbar />

      {/* Hero */}
      <TitleHeroWithWatchlist detail={detail} mediaType={type} />

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-20 space-y-10">
        
        {/* Trailer */}
        {trailer && (
          <section>
            <h3 className="text-white font-semibold text-base mb-3">Trailer</h3>
            <div className="aspect-video max-w-3xl rounded-2xl overflow-hidden bg-white/5 border border-white/5">
              <iframe
                src={`https://www.youtube.com/embed/${trailer.key}?rel=0&modestbranding=1`}
                className="w-full h-full"
                allowFullScreen
                allow="autoplay; encrypted-media"
                loading="lazy"
              />
            </div>
          </section>
        )}

        {/* Season/Episode Selector (TV Shows) */}
        {type === 'tv' && seasons && seasons.length > 0 && (
          <section>
            <h3 className="text-white font-semibold text-base mb-3">Episodes</h3>
            <SeasonSelector
              tmdbId={id}
              seasons={seasons}
              episodes={episodes}
              selectedSeason={selectedSeason}
              onSeasonChange={setSelectedSeason}
              isLoadingEpisodes={isLoadingEpisodes}
            />
          </section>
        )}

        {/* Cast */}
        <section>
          <CastCarousel cast={cast} />
        </section>

        {/* More Like This */}
        <section>
          <SimilarTitles items={similar} />
        </section>
      </div>
    </div>
  );
}

// Wrapper to wire up Zustand watchlist
function TitleHeroWithWatchlist({ detail, mediaType }: { detail: any; mediaType: 'movie' | 'tv' }) {
  const { isInWatchlist, toggleWatchlist } = useMediaStore();
  const tmdbId = detail.id;
  const inList = isInWatchlist(tmdbId);

  return (
    <TitleHero
      detail={detail}
      mediaType={mediaType}
      isInWatchlist={inList}
      onToggleWatchlist={() => toggleWatchlist({
        id: tmdbId,
        tmdbId,
        type: mediaType,
        title: detail.title || detail.name || '',
        posterPath: detail.poster_path,
      })}
    />
  );
}

export default function TitlePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black">
        <div className="w-full h-[70vh] shimmer" />
      </div>
    }>
      <TitlePageInner />
    </Suspense>
  );
}
