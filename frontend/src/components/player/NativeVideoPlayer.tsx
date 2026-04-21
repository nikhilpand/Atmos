"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import Hls from 'hls.js';

interface NativeVideoPlayerProps {
  src: string;
  isHls?: boolean;
  title?: string;
  onFatalError?: () => void;
  autoPlay?: boolean;
}

export default function NativeVideoPlayer({ src, isHls = false, title, onFatalError, autoPlay = true }: NativeVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  
  const controlsTimer = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Initialize HLS.js or Native Video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const startVideo = async () => {
      try {
        if (autoPlay) await video.play();
        setIsPlaying(true);
      } catch (err) {
        console.warn("Autoplay blocked:", err);
      }
    };

    if (isHls) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS Support (Safari)
        video.src = src;
        startVideo();
        setIsLoading(false);
      } else if (Hls.isSupported()) {
        // HLS.js Configuration for Zero-Buffering
        const hls = new Hls({
          maxBufferLength: 60,
          maxMaxBufferLength: 120, // 2 minutes of buffer
          maxBufferSize: 100 * 1000 * 1000, // 100MB buffer
          enableWorker: true,
          lowLatencyMode: false,
          startLevel: -1, // Auto-quality
          abrEwmaDefaultEstimate: 5000000, // Start assuming a 5Mbps connection
        });
        
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsLoading(false);
          startVideo();
        });
        
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.error("HLS Network Error, attempting recovery...");
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.error("HLS Media Error, attempting recovery...");
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                setHasError(true);
                if (onFatalError) onFatalError();
                break;
            }
          }
        });
      } else {
        setHasError(true);
        if (onFatalError) onFatalError();
      }
    } else {
      // Direct MP4 / File Playback
      video.src = src;
      startVideo();
      setIsLoading(false);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
    };
  }, [src, isHls, autoPlay, onFatalError]);

  // Controls Logic
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3500);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, []);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { 
      v.play().catch(()=>console.log("Play failed")); 
      setIsPlaying(true); 
    } else { 
      v.pause(); 
      setIsPlaying(false); 
    }
    resetControlsTimer();
  }, [resetControlsTimer]);

  const toggleMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  const seek = useCallback((seconds: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + seconds));
    resetControlsTimer();
  }, [resetControlsTimer]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    v.currentTime = pct * duration;
    resetControlsTimer();
  }, [duration, resetControlsTimer]);

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Keyboard and Double Tap
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't interfere with inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); seek(-10); break;
        case 'ArrowRight': e.preventDefault(); seek(10); break;
        case 'm': case 'M': toggleMute(); break;
        case 'f': case 'F': toggleFullscreen(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, seek, toggleMute, toggleFullscreen]);

  if (hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="text-center">
          <AlertTriangle size={48} className="text-amber-400 mx-auto mb-4" />
          <p className="text-white/70 text-lg font-medium mb-2">Stream failed to load</p>
          <p className="text-white/30 text-sm mb-6">The source might be offline or blocked.</p>
          {onFatalError && (
            <button
              onClick={() => { setHasError(false); onFatalError(); }}
              className="flex items-center gap-2 px-5 py-2.5 mx-auto rounded-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all"
            >
              <RefreshCw size={14} /> Try Fallback
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group overflow-hidden"
      onMouseMove={resetControlsTimer}
      onTouchStart={resetControlsTimer}
      onClick={togglePlay}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        onPlay={() => { setIsPlaying(true); resetControlsTimer(); }}
        onPause={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); setIsLoading(false); }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setProgress(v.duration ? (v.currentTime / v.duration) * 100 : 0);
        }}
        onWaiting={() => setIsLoading(true)}
        onCanPlay={() => setIsLoading(false)}
        onError={() => {
           if(!isHls) { setHasError(true); if(onFatalError) onFatalError(); }
        }}
      />

      {/* Loading overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-black/40"
          >
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-white/5" />
              <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
              <div className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Badges */}
      <div className="absolute top-4 right-4 z-10 flex gap-2 pointer-events-none">
        {isHls && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur border border-emerald-500/20 text-emerald-400">
            <ShieldCheck size={12} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Ad-Free</span>
          </div>
        )}
      </div>

      {/* Player Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-24 pb-6"
            onClick={(e) => e.stopPropagation()} // Prevent playing video when clicking controls area
          >
            {/* Progress Bar */}
            <div
              className="mx-6 mb-4 h-1.5 bg-white/20 rounded-full cursor-pointer relative group/bar hover:h-2 transition-all"
              onClick={handleProgressClick}
            >
              <div
                className="absolute left-0 top-0 bottom-0 bg-violet-500 rounded-full transition-all ease-linear"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover/bar:opacity-100 transition-opacity"
                style={{ left: `calc(${progress}% - 8px)` }}
              />
            </div>

            {/* Buttons Row */}
            <div className="flex items-center justify-between px-6">
              <div className="flex items-center gap-4 sm:gap-6">
                <button onClick={(e) => togglePlay(e)} className="w-12 h-12 rounded-full bg-white text-black hover:bg-gray-200 flex items-center justify-center transition-all transform hover:scale-105 shadow-xl">
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                </button>
                
                <div className="flex items-center gap-3">
                  <button onClick={(e) => seek(-10, e)} className="text-white/70 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full">
                    <SkipBack size={20} />
                  </button>
                  <button onClick={(e) => seek(10, e)} className="text-white/70 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full">
                    <SkipForward size={20} />
                  </button>
                </div>
                
                <div className="flex items-center gap-2 group/volume">
                  <button onClick={(e) => toggleMute(e)} className="text-white/70 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full">
                    {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </button>
                </div>
                
                <div className="text-white/80 text-sm font-medium tabular-nums border-l border-white/20 pl-4">
                  {formatTime((progress / 100) * duration)} <span className="text-white/40 font-normal mx-1">/</span> {formatTime(duration)}
                </div>
              </div>

              <div className="flex items-center gap-4">
                {title && (
                  <span className="text-white/60 text-sm font-medium truncate max-w-[200px] hidden md:block">
                    {title}
                  </span>
                )}
                <button onClick={(e) => toggleFullscreen(e)} className="text-white/70 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full">
                  {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
