import React from 'react';
import { useWeather } from '../context/WeatherContext';
import { WEATHER_CONDITIONS } from '../types';
import { MapPin, Wind, Sun, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';

export const Forecast: React.FC = () => {
  const { weather, loading } = useWeather();
  const location = useStore((state) => state.currentLocation);

  if (loading || !weather) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="animate-pulse text-primary font-headline text-2xl tracking-widest uppercase">Syncing Forecast Data...</div>
      </div>
    );
  }

  const chartData = weather.daily.time.map((time, i) => ({
    name: format(new Date(time), 'EEE'),
    max: weather.daily.tempMax[i],
    min: weather.daily.tempMin[i],
  }));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="flex-grow pt-28 pb-12 px-6 md:px-12 max-w-7xl mx-auto w-full"
    >
      <header className="mb-12 relative overflow-hidden rounded-xl p-8 min-h-[300px] flex flex-col justify-end">
        <div className="absolute inset-0 z-0">
          <img 
            className="w-full h-full object-cover opacity-40" 
            src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=1920" 
            alt="Forecast BG"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/60 to-transparent"></div>
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <MapPin className="text-primary" size={16} />
            <h2 className="text-on-surface-variant tracking-widest uppercase text-xs font-semibold">{location.name}, {location.country}</h2>
          </div>
          <h1 className="font-headline text-5xl md:text-7xl font-extrabold tracking-tighter mb-2">7-Day Forecast</h1>
          <p className="text-on-surface-variant max-w-xl font-light text-lg">Stable high-pressure systems bringing clear skies and cooler air masses across the northern corridor.</p>
        </div>
      </header>

      <section className="mb-12">
        <div className="glass-card rounded-xl p-8 border border-white/5">
          <div className="flex justify-between items-end mb-8">
            <div>
              <h3 className="font-headline text-xl font-bold text-primary">Temperature Trend</h3>
              <p className="text-on-surface-variant text-xs uppercase tracking-widest mt-1">Expected Variance: {Math.min(...weather.daily.tempMin)}°C — {Math.max(...weather.daily.tempMax)}°C</p>
            </div>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-primary"></span>
                <span className="text-xs text-on-surface-variant">Day</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-secondary"></span>
                <span className="text-xs text-on-surface-variant">Night</span>
              </div>
            </div>
          </div>
          
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorMax" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3bbffa" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3bbffa" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6d758c', fontSize: 10 }} />
                <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#141f38', border: '1px solid #40485d', borderRadius: '8px' }}
                  itemStyle={{ color: '#dee5ff' }}
                />
                <Area type="monotone" dataKey="max" stroke="#3bbffa" strokeWidth={3} fillOpacity={1} fill="url(#colorMax)" />
                <Area type="monotone" dataKey="min" stroke="#f673b7" strokeWidth={2} strokeDasharray="5 5" fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {weather.daily.time.map((time, i) => {
          const condition = WEATHER_CONDITIONS[weather.daily.conditionCode[i]] || { label: 'Unknown', icon: 'cloud' };
          const isToday = i === 0;
          return (
            <div 
              key={i} 
              className={cn(
                "glass-card rounded-xl p-6 border flex flex-col justify-between hover:bg-white/10 transition-all cursor-pointer",
                isToday ? "border-primary/20 sm:col-span-2" : "border-white/5"
              )}
            >
              <div className="flex justify-between items-start">
                <div>
                  {isToday && <span className="bg-primary-container text-on-primary-container text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">Today</span>}
                  <h4 className={cn("font-headline font-bold mt-4", isToday ? "text-2xl" : "text-lg")}>
                    {format(new Date(time), isToday ? 'EEEE, MMM d' : 'EEEE')}
                  </h4>
                  <p className="text-on-surface-variant text-xs uppercase tracking-widest font-semibold mt-1">
                    {format(new Date(time), 'MMM d')}
                  </p>
                </div>
                <span className="material-symbols-outlined text-4xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {condition.icon}
                </span>
              </div>
              <div className="mt-8 flex justify-between items-end">
                <div className="flex items-baseline gap-2">
                  <span className={cn("font-headline font-extrabold tracking-tighter text-white", isToday ? "text-6xl" : "text-2xl")}>
                    {weather.daily.tempMax[i]}°
                  </span>
                  <span className={cn("text-slate-500 font-light", isToday ? "text-2xl" : "text-sm")}>
                    / {weather.daily.tempMin[i]}°
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1 text-sky-400">
                    <span className="material-symbols-outlined text-sm">water_drop</span>
                    <span className="text-sm font-medium">{weather.daily.precipitationProbability[i]}%</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 rounded-xl border border-white/5">
          <div className="flex items-center gap-3 mb-4">
            <Wind className="text-primary-dim" size={20} />
            <h5 className="font-headline font-bold text-slate-200">Wind Dynamics</h5>
          </div>
          <p className="text-on-surface-variant text-sm leading-relaxed">Predominant {weather.current.windDirection} winds at {weather.current.windSpeed} km/h. Gusts up to {weather.current.gusts} km/h expected.</p>
        </div>
        <div className="glass-card p-6 rounded-xl border border-white/5">
          <div className="flex items-center gap-3 mb-4">
            <Sun className="text-primary-dim" size={20} />
            <h5 className="font-headline font-bold text-slate-200">UV Index</h5>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-3xl font-headline font-extrabold text-white">Low</span>
            <div className="flex-grow bg-slate-800 h-1 rounded-full overflow-hidden">
              <div className="bg-primary-container h-full w-[20%]"></div>
            </div>
          </div>
          <p className="text-on-surface-variant text-[10px] uppercase tracking-widest mt-4">Safe for prolonged exposure</p>
        </div>
        <div className="glass-card p-6 rounded-xl border border-white/5">
          <div className="flex items-center gap-3 mb-4">
            <Eye className="text-primary-dim" size={20} />
            <h5 className="font-headline font-bold text-slate-200">Visibility</h5>
          </div>
          <span className="text-3xl font-headline font-extrabold text-white">{weather.current.visibility} <span className="text-sm font-normal text-slate-400 uppercase">km</span></span>
          <p className="text-on-surface-variant text-sm mt-2">Atmospheric clarity remains high throughout the forecast period.</p>
        </div>
      </section>
    </motion.div>
  );
};
