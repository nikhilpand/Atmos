import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Maximize, Minimize } from 'lucide-react';
import { cn } from '../lib/utils';

interface WindyMapProps {
  lat: number;
  lon: number;
  overlay?: string;
  zoom?: number;
  className?: string;
  showFullscreenButton?: boolean;
}

export const WindyMap: React.FC<WindyMapProps> = ({ 
  lat, lon, overlay = 'radar', zoom = 5, className, showFullscreenButton = false 
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
      document.body.classList.add('radar-fullscreen');
    } else {
      document.body.style.overflow = 'unset';
      document.body.classList.remove('radar-fullscreen');
    }
    return () => {
      document.body.style.overflow = 'unset';
      document.body.classList.remove('radar-fullscreen');
    };
  }, [isFullscreen]);

  const product = overlay === 'radar' ? 'radar' : 'ecmwf';
  const src = `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=${zoom}&overlay=${overlay}&product=${product}&level=surface&lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&marker=true`;

  const mapContent = (
    <>
      <iframe
        width="100%"
        height="100%"
        src={src}
        frameBorder="0"
        className={cn("w-full h-full", className)}
      ></iframe>
      {showFullscreenButton && (
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] p-2 bg-surface-variant/80 backdrop-blur-md border border-outline-variant/30 rounded-full text-on-surface hover:bg-white/20 transition-all shadow-lg flex items-center gap-2 px-4"
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          <span className="text-xs font-bold uppercase tracking-widest">{isFullscreen ? "Exit" : "Fullscreen"}</span>
        </button>
      )}
    </>
  );

  if (isFullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] w-screen h-screen bg-background">
        {mapContent}
      </div>,
      document.body
    );
  }

  return (
    <div className="relative z-0 w-full h-full">
      {mapContent}
    </div>
  );
};
