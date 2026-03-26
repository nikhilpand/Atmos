import { GoogleGenAI } from "@google/genai";
import { WeatherData, WEATHER_CONDITIONS } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const insightsCache = new Map<string, { text: string; timestamp: number }>();
const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes

export async function getWeatherInsights(weather: WeatherData, locationName: string) {
  const currentCondition = WEATHER_CONDITIONS[weather.current.conditionCode]?.label || "Unknown";
  
  // Create a cache key based on location and current weather state
  const cacheKey = `${locationName}-${weather.current.temp}-${currentCondition}`;
  const cached = insightsCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    return cached.text;
  }

  const prompt = `
    Provide a friendly, easy-to-understand weather report for ${locationName}.
    Current conditions: ${weather.current.temp}°C, ${currentCondition}.
    Humidity: ${weather.current.humidity}%, Wind: ${weather.current.windSpeed} km/h ${weather.current.windDirection}.
    Forecast: High of ${weather.daily.tempMax[0]}°C, Low of ${weather.daily.tempMin[0]}°C.
    
    Explain what this means for someone's day in simple terms. Keep it under 40 words.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: prompt,
    });
    
    const text = response.text || "The weather is looking normal today.";
    insightsCache.set(cacheKey, { text, timestamp: Date.now() });
    return text;
  } catch (error: any) {
    console.error("Gemini Error:", error);
    
    // If we have a stale cache, return it as a fallback
    if (cached) return cached.text;
    
    return "The weather is looking normal today.";
  }
}
