import React from 'react';
import { useWeather } from '../context/WeatherContext';
import { WEATHER_CONDITIONS } from '../types';
import { MapPin, CloudRain, Sun, Thermometer, Droplets, Wind, ChevronLeft, ChevronRight, Wind as WindIcon, Activity, CloudSun } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';

import { WindyMap } from './WindyMap';
import { AtmosphericAudio } from './AtmosphericAudio';

const getBackgroundVideo = (conditionCode: number) => {
  const condition = WEATHER_CONDITIONS[conditionCode];
  const isDayTime = conditionCode < 33; // AccuWeather codes 33+ are night

  const defaultDay = { url: 'https://cdn.flixel.com/flixel/hlhff0h8md4ev0kju5be.hd.mp4', overlay: 'bg-black/20' };
  const defaultNight = { url: 'https://cdn.flixel.com/flixel/x9dr8caygivq5secll7i.hd.mp4', overlay: 'bg-black/50' };

  if (!condition) return isDayTime ? defaultDay : defaultNight;
  
  if (condition.isStormy) return { url: 'https://cdn.flixel.com/flixel/f0w23bd0enxur5ff0bxz.hd.mp4', overlay: 'bg-slate-900/60' };
  if (condition.isSnowy) return { url: 'https://cdn.flixel.com/flixel/vwqzlk4turo2449be9uf.hd.mp4', overlay: 'bg-white/20' };
  if (condition.isRainy) return { url: 'https://cdn.flixel.com/flixel/f0w23bd0enxur5ff0bxz.hd.mp4', overlay: 'bg-slate-800/40' };
  if (condition.label.includes('Fog') || condition.label.includes('Hazy')) return { url: 'https://cdn.flixel.com/flixel/vwqzlk4turo2449be9uf.hd.mp4', overlay: 'bg-slate-400/30' };
  if (condition.label.includes('Cloud')) return isDayTime ? { url: 'https://cdn.flixel.com/flixel/13e0s6coh6ayapvdyqnv.hd.mp4', overlay: 'bg-black/30' } : { url: 'https://cdn.flixel.com/flixel/ypy8bw9fgw1zv2b4htp2.hd.mp4', overlay: 'bg-black/60' };
  
  return isDayTime ? defaultDay : defaultNight;
};

const getAqiLabel = (aqi: number) => {
  if (aqi <= 20) return { label: 'Good', color: 'text-green-400' };
  if (aqi <= 40) return { label: 'Fair', color: 'text-yellow-400' };
  if (aqi <= 60) return { label: 'Moderate', color: 'text-orange-400' };
  if (aqi <= 80) return { label: 'Poor', color: 'text-red-400' };
  if (aqi <= 100) return { label: 'Very Poor', color: 'text-purple-400' };
  return { label: 'Extremely Poor', color: 'text-rose-600' };
};

export const Dashboard: React.FC = () => {
  const { weather, insights, loading, error, refreshWeather } = useWeather();
  const { currentLocation: location, setActiveTab } = useStore();

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] px-8 text-center">
        <div className="text-red-500 font-headline text-2xl tracking-widest uppercase mb-4">Atmospheric Data Failure</div>
        <p className="text-on-surface-variant max-w-md mb-8">{error}</p>
        <button 
          onClick={() => refreshWeather()}
          className="px-8 py-3 bg-primary text-on-primary rounded-full font-bold tracking-widest uppercase hover:opacity-90 transition-all"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  if (loading || !weather) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="animate-pulse text-primary font-headline text-2xl tracking-widest uppercase">Initializing Atmospheric Data...</div>
      </div>
    );
  }

  const currentCondition = WEATHER_CONDITIONS[weather.current.conditionCode] || { label: 'Unknown', icon: 'cloud' };
  const isStormy = currentCondition.isStormy;
  const bgData = getBackgroundVideo(weather.current.conditionCode);
  const aqiInfo = weather.airQuality ? getAqiLabel(weather.airQuality.aqi) : { label: 'Unknown', color: 'text-on-surface-variant' };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className={cn(
        "flex flex-col transition-all duration-700",
        isStormy && "bg-red-950/20"
      )}
    >
      {/* Severe Weather Alert Bar */}
      {isStormy && (
        <motion.div 
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          className="bg-red-600 text-white py-3 px-8 flex items-center justify-between z-[60] sticky top-20 shadow-2xl"
        >
          <div className="flex items-center gap-4">
            <Activity className="animate-pulse" size={24} />
            <span className="font-headline font-bold tracking-widest uppercase text-sm">Severe Weather War Room Active</span>
          </div>
          <div className="hidden md:flex gap-8 text-xs font-bold tracking-widest uppercase">
            <span>High Risk: Lightning & Heavy Rain</span>
            <span>Safety: Stay Indoors</span>
          </div>
        </motion.div>
      )}

      {/* Hero Section */}
      <section className={cn(
        "relative w-full min-h-[614px] md:min-h-[716px] flex items-center px-8 lg:px-24 py-24 overflow-hidden transition-all duration-1000",
        isStormy && "border-b-4 border-red-600/50"
      )}>
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-20"></div>
          <div className={cn("absolute inset-0 z-10 transition-colors duration-1000", bgData.overlay)}></div>
          <video 
            key={bgData.url}
            className="w-full h-full object-cover transition-opacity duration-1000" 
            src={bgData.url} 
            autoPlay
            loop
            muted
            playsInline
          />
        </div>

        <div className="relative z-20 flex flex-col md:flex-row items-start md:items-center justify-between w-full gap-12 mt-12 md:mt-0">
          <div className="max-w-2xl w-full">
            <div className="flex items-center gap-3 mb-4">
              <MapPin className="text-primary fill-primary" size={20} />
              <span className="font-headline tracking-widest text-on-surface-variant uppercase text-sm">{location.name}, {location.country}</span>
            </div>
            <h1 className="font-headline text-8xl md:text-[10rem] font-extrabold tracking-tighter leading-none mb-2">{weather.current.temp}°</h1>
            
            {/* Nowcasting Widget */}
            {weather.minutely && (
              <div className="flex items-center gap-4 mb-6 bg-white/5 backdrop-blur-md p-3 rounded-2xl border border-white/10 w-fit">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest text-primary font-bold">Nowcasting</span>
                  <span className="text-sm font-medium">
                    {weather.minutely.precipitation[0] > 0 
                      ? `Rain detected: ${weather.minutely.precipitation[0]}mm/h`
                      : "No precipitation expected in the next hour"}
                  </span>
                </div>
                <div className="flex gap-1 items-end h-8">
                  {weather.minutely.precipitation.slice(0, 12).map((p, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "w-1 rounded-t-full transition-all duration-500",
                        p > 0 ? "bg-primary" : "bg-white/10"
                      )} 
                      style={{ height: `${Math.min(100, p * 20 + 10)}%` }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col">
              <span className="font-headline text-3xl md:text-5xl font-light text-on-surface tracking-tight mb-6">{currentCondition.label}</span>
              
              <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-2 text-primary">
                  <CloudSun size={18} />
                  <span className="font-headline text-xs font-bold tracking-widest uppercase">Daily Report</span>
                </div>
                <p className="text-on-surface max-w-lg font-normal leading-relaxed text-lg bg-white/5 backdrop-blur-md p-4 rounded-lg border border-white/10 shadow-lg">
                  {insights}
                </p>
              </div>

              <div className="flex gap-4 mt-6">
                <span className="bg-secondary-container text-on-secondary-container px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase">High Warning</span>
                <span className="bg-primary-container/20 text-primary px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase">Safe Visibility</span>
              </div>
            </div>
          </div>

          <div className="glass-panel p-8 rounded-xl border border-outline-variant/15 flex flex-col gap-6 w-full md:min-w-[320px] md:w-auto">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs uppercase tracking-widest text-on-surface-variant font-bold">Air Quality (AQI)</span>
                <span className={cn("text-xl font-headline font-semibold", aqiInfo.color)}>
                  {weather.airQuality ? weather.airQuality.aqi : '--'} {aqiInfo.label}
                </span>
              </div>
              <Activity className={aqiInfo.color} size={32} />
            </div>
            
            {weather.airQuality && (
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">PM2.5</span>
                  <span className="text-sm font-semibold">{weather.airQuality.pm2_5} <span className="text-[10px] font-normal text-on-surface-variant">µg/m³</span></span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">PM10</span>
                  <span className="text-sm font-semibold">{weather.airQuality.pm10} <span className="text-[10px] font-normal text-on-surface-variant">µg/m³</span></span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">NO₂</span>
                  <span className="text-sm font-semibold">{weather.airQuality.nitrogenDioxide} <span className="text-[10px] font-normal text-on-surface-variant">µg/m³</span></span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">O₃</span>
                  <span className="text-sm font-semibold">{weather.airQuality.ozone} <span className="text-[10px] font-normal text-on-surface-variant">µg/m³</span></span>
                </div>
              </div>
            )}
            
            <button 
              onClick={() => setActiveTab('maps')}
              className="w-full py-3 mt-2 bg-primary-container text-on-primary-container rounded-lg font-bold text-sm tracking-widest uppercase hover:opacity-90 transition-all"
            >
              Full Radar View
            </button>
          </div>
        </div>
      </section>

      {/* Bento Grid Metrics */}
      <section className="px-8 lg:px-24 py-12 grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-panel p-6 rounded-xl border border-outline-variant/15 flex flex-col justify-between h-48">
          <div className="flex justify-between items-start">
            <Thermometer className="text-primary" size={20} />
            <span className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Daily Range</span>
          </div>
          <div>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-headline font-bold">{weather.daily.tempMax[0]}°</span>
              <span className="text-on-surface-variant pb-1">/ {weather.daily.tempMin[0]}°</span>
            </div>
            <p className="text-xs text-on-surface-variant mt-1">Average for this time of year</p>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-xl border border-outline-variant/15 flex flex-col justify-between h-48">
          <div className="flex justify-between items-start">
            <Droplets className="text-primary" size={20} />
            <span className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Humidity</span>
          </div>
          <div>
            <span className="text-3xl font-headline font-bold">{weather.current.humidity}%</span>
            <div className="w-full bg-surface-container-highest h-1 rounded-full mt-3 overflow-hidden">
              <div className="bg-primary h-full" style={{ width: `${weather.current.humidity}%` }}></div>
            </div>
            <p className="text-xs text-on-surface-variant mt-2">Dew point: {weather.current.dewPoint}°</p>
          </div>
        </div>

        <div className="md:col-span-2 glass-panel p-6 rounded-xl border border-outline-variant/15 flex flex-col h-48">
          <div className="flex justify-between items-start mb-4">
            <Wind className="text-primary" size={20} />
            <span className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Wind Metrics</span>
          </div>
          <div className="flex items-center gap-12 mt-auto">
            <div>
              <span className="text-4xl font-headline font-bold tracking-tighter">{weather.current.windSpeed} <span className="text-lg font-normal">km/h</span></span>
              <p className="text-xs text-on-surface-variant mt-1 uppercase tracking-widest">{weather.current.windDirection}</p>
            </div>
            <div className="flex-1 border-l border-outline-variant/30 pl-8">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-on-surface-variant">Gusts</span>
                <span className="text-sm font-semibold">{weather.current.gusts} km/h</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-on-surface-variant">Pressure</span>
                <span className="text-sm font-semibold">{weather.current.pressure} hPa</span>
              </div>
            </div>
          </div>
        </div>

        {/* Hourly Forecast */}
        <div className="md:col-span-4 mt-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-headline text-2xl font-semibold tracking-tight">Hourly Forecast</h2>
            <div className="flex gap-2">
              <button className="p-2 rounded-full bg-surface-container-high hover:bg-surface-bright transition-all">
                <ChevronLeft size={20} />
              </button>
              <button className="p-2 rounded-full bg-surface-container-high hover:bg-surface-bright transition-all">
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-4">
            {weather.hourly.time.slice(0, 8).map((time, i) => {
              const condition = WEATHER_CONDITIONS[weather.hourly.conditionCode[i]] || { label: 'Unknown', icon: 'cloud' };
              const isNow = i === 0;
              return (
                <div 
                  key={i} 
                  className={cn(
                    "flex flex-col items-center p-4 rounded-xl transition-all",
                    isNow ? "bg-surface-container-highest border border-primary/20" : "hover:bg-surface-container-high"
                  )}
                >
                  <span className={cn("text-xs font-bold uppercase tracking-widest mb-4", isNow ? "text-primary" : "text-on-surface-variant")}>
                    {isNow ? 'Now' : format(new Date(time), 'HH:00')}
                  </span>
                  <span className="material-symbols-outlined text-2xl text-primary mb-4" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {condition.icon}
                  </span>
                  <span className="text-xl font-headline font-bold">{weather.hourly.temp[i]}°</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Radar Mini Map */}
      <section className="px-8 lg:px-24 py-12">
        <div className="w-full h-96 rounded-2xl overflow-hidden relative border border-outline-variant/15">
          <WindyMap 
            lat={location.lat} 
            lon={location.lon} 
            zoom={5} 
            showFullscreenButton={true} 
            className="grayscale-[0.3] contrast-[1.1]" 
          />
          <div className="absolute inset-0 bg-primary/5 pointer-events-none z-10"></div>
          <div className="absolute top-6 left-6 z-20 glass-panel p-4 rounded-lg border border-outline-variant/20 pointer-events-none">
            <h3 className="text-sm font-bold uppercase tracking-widest mb-1">Precipitation Radar</h3>
            <p className="text-xs text-on-surface-variant">Live tracking • Interactive</p>
          </div>
        </div>
      </section>
      <AtmosphericAudio conditionCode={weather.current.conditionCode} />
    </motion.div>
  );
};
