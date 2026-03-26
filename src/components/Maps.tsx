import React, { useState } from 'react';
import { Radar, Thermometer, Wind, Cloud, MapPin } from 'lucide-react';
import { cn } from '../lib/utils';
import { useWeather } from '../context/WeatherContext';
import { WindyMap } from './WindyMap';
import { useStore } from '../store/useStore';

export const Maps: React.FC = () => {
  const [activeLayer, setActiveLayer] = useState('radar');
  const location = useStore((state) => state.currentLocation);

  const layers = [
    { id: 'radar', label: 'Radar', icon: Radar, overlay: 'radar' },
    { id: 'temp', label: 'Temp', icon: Thermometer, overlay: 'temp' },
    { id: 'wind', label: 'Wind', icon: Wind, overlay: 'wind' },
    { id: 'cloud', label: 'Cloud', icon: Cloud, overlay: 'clouds' },
  ];

  const currentOverlay = layers.find(l => l.id === activeLayer)?.overlay || 'radar';

  return (
    <main className="relative w-screen h-screen pt-20 overflow-hidden bg-background">
      <div className="absolute inset-0 z-0 pt-20">
        <WindyMap 
          lat={location.lat} 
          lon={location.lon} 
          overlay={currentOverlay} 
          zoom={5} 
          showFullscreenButton={true} 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-40 pointer-events-none z-10"></div>
      </div>

      {/* Left Overlay: Layer Selection */}
      <div className="absolute left-8 top-28 z-20 flex flex-col gap-4">
        <div className="glass-panel bg-surface-variant/80 p-2 rounded-xl border border-outline-variant/30 flex flex-col gap-1 shadow-2xl">
          {layers.map((layer) => (
            <button
              key={layer.id}
              onClick={() => setActiveLayer(layer.id)}
              className={cn(
                "flex flex-col items-center justify-center w-14 h-14 rounded-lg transition-all",
                activeLayer === layer.id 
                  ? "bg-primary-container text-on-primary-container" 
                  : "hover:bg-white/10 text-on-surface-variant"
              )}
            >
              <layer.icon size={20} />
              <span className="text-[10px] font-bold mt-1">{layer.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Floating Info */}
      <div className="absolute left-28 top-32 z-20 pointer-events-none">
        <div className="glass-panel bg-primary-container/20 px-4 py-2 rounded-full border border-primary/20 flex items-center gap-3 shadow-lg backdrop-blur-md">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
          <span className="font-headline text-sm font-bold tracking-tight text-white">Live Weather Map</span>
          <span className="text-xs font-medium text-on-surface-variant">| {location.name}</span>
        </div>
      </div>
    </main>
  );
};
