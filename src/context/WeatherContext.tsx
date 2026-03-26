import React, { createContext, useContext, useState, useEffect } from 'react';
import { WeatherData } from '../types';
import { fetchWeather } from '../services/weatherService';
import { getWeatherInsights } from '../services/geminiService';
import { useStore } from '../store/useStore';

interface WeatherContextType {
  weather: WeatherData | null;
  insights: string;
  loading: boolean;
  error: string | null;
  refreshWeather: () => Promise<void>;
}

const WeatherContext = createContext<WeatherContextType | undefined>(undefined);

export const WeatherProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const currentLocation = useStore((state) => state.currentLocation);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [insights, setInsights] = useState('Analyzing atmospheric data...');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshWeather = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWeather(currentLocation.lat, currentLocation.lon);
      setWeather(data);
      const aiInsights = await getWeatherInsights(data, currentLocation.name);
      setInsights(aiInsights);
    } catch (err: any) {
      console.error('Failed to fetch weather:', err);
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshWeather();
  }, [currentLocation]);

  return (
    <WeatherContext.Provider value={{ weather, insights, loading, error, refreshWeather }}>
      {children}
    </WeatherContext.Provider>
  );
};

export const useWeather = () => {
  const context = useContext(WeatherContext);
  if (!context) throw new Error('useWeather must be used within a WeatherProvider');
  return context;
};
