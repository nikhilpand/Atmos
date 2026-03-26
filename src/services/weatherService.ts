import { GoogleGenAI, Type } from "@google/genai";
import { Location, WeatherData, getWindDirection } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Simple in-memory cache for intelligent search results
const searchCache = new Map<string, Location | null>();
let aiCooldownUntil = 0;

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  let response;
  try {
    response = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
  } catch (e) {
    throw new Error(`Network error: Failed to connect to weather API. ${e instanceof Error ? e.message : ''}`);
  }
  
  if (!response.ok) {
    let errorMsg = 'Failed to fetch weather data';
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || errorMsg;
    } catch (e) {}
    throw new Error(errorMsg);
  }

  const data = await response.json();

  // Fetch Air Quality Data via Proxy
  let airQuality;
  try {
    const aqRes = await fetch(`/api/air-quality?lat=${lat}&lon=${lon}`);
    if (aqRes.ok) {
      const aqData = await aqRes.json();
      if (aqData) {
        airQuality = {
          aqi: aqData.current.european_aqi,
          pm10: aqData.current.pm10,
          pm2_5: aqData.current.pm2_5,
          carbonMonoxide: aqData.current.carbon_monoxide,
          nitrogenDioxide: aqData.current.nitrogen_dioxide,
          ozone: aqData.current.ozone,
        };
      }
    }
  } catch (e) {
    console.error('Failed to fetch air quality data', e);
  }

  return {
    current: {
      temp: Math.round(data.current.Temperature.Metric.Value),
      condition: data.current.WeatherText,
      conditionCode: data.current.WeatherIcon,
      precipitation: data.current.PrecipitationSummary?.Precipitation?.Metric?.Value || 0,
      uvIndex: data.current.UVIndex || 0,
      humidity: data.current.RelativeHumidity || 0,
      dewPoint: Math.round(data.current.DewPoint?.Metric?.Value || 0),
      windSpeed: Math.round(data.current.Wind?.Speed?.Metric?.Value || 0),
      windDirection: getWindDirection(data.current.Wind?.Direction?.Degrees || 0),
      gusts: Math.round(data.current.WindGust?.Speed?.Metric?.Value || 0),
      pressure: Math.round(data.current.Pressure?.Metric?.Value || 0),
      visibility: Math.round(data.current.Visibility?.Metric?.Value || 0),
    },
    airQuality,
    hourly: {
      time: data.hourly.map((h: any) => h.DateTime),
      temp: data.hourly.map((h: any) => Math.round(h.Temperature.Value)),
      conditionCode: data.hourly.map((h: any) => h.WeatherIcon),
    },
    daily: {
      time: data.daily.DailyForecasts.map((d: any) => d.Date),
      tempMax: data.daily.DailyForecasts.map((d: any) => Math.round(d.Temperature.Maximum.Value)),
      tempMin: data.daily.DailyForecasts.map((d: any) => Math.round(d.Temperature.Minimum.Value)),
      conditionCode: data.daily.DailyForecasts.map((d: any) => d.Day.Icon),
      precipitationProbability: data.daily.DailyForecasts.map((d: any) => Math.max(d.Day.PrecipitationProbability || 0, d.Night.PrecipitationProbability || 0)),
    },
    astronomy: data.astronomy,
    minutely: data.minutely,
  };
}

export async function searchLocations(query: string): Promise<Location[]> {
  if (!query) return [];
  const url = `/api/locations?q=${encodeURIComponent(query)}`;
  let response;
  try {
    response = await fetch(url);
  } catch (e) {
    console.error('Network error during location search:', e);
    return [];
  }
  
  if (!response.ok) {
    console.error('Location search failed with status:', response.status);
    return [];
  }

  const data = await response.json();
  
  return data.map((item: any) => ({
    name: item.display_name.split(',')[0],
    country: item.display_name.split(',').pop().trim(),
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
  }));
}

export async function intelligentSearch(query: string): Promise<Location | null> {
  if (!query || query.length < 3) return null;

  const normalizedQuery = query.toLowerCase().trim();
  if (searchCache.has(normalizedQuery)) {
    return searchCache.get(normalizedQuery) || null;
  }

  // Fallback function to avoid repetition
  const fallbackSearch = async () => {
    try {
      const directLocs = await searchLocations(query);
      const fallbackLoc = directLocs.length > 0 ? directLocs[0] : null;
      searchCache.set(normalizedQuery, fallbackLoc);
      return fallbackLoc;
    } catch (e) {
      return null;
    }
  };

  // HYBRID SEARCH LOGIC:
  // Check if the query looks like a question or a complex request.
  // If it's just a simple location (e.g., "London", "New York"), skip AI to save quota.
  const questionKeywords = /\?|where|how|what|is|it|weather|raining|sunny|hot|cold|warmest|coldest|forecast|report|now|current/i;
  const isQuestion = questionKeywords.test(normalizedQuery);

  if (!isQuestion) {
    const directResult = await fallbackSearch();
    if (directResult) return directResult;
  }

  // Check if AI is in cooldown due to rate limits
  if (Date.now() < aiCooldownUntil) {
    console.info("Gemini is in cooldown. Using direct search fallback.");
    return fallbackSearch();
  }

  const prompt = `
    The user is asking a weather-related question or searching for a location: "${query}".
    
    If they are asking a question like "Where is it raining?", "Where is it sunny?", or "Warmest city in Europe?", you MUST use Google Search to find REAL-TIME, CURRENT weather data. 
    Identify a real city that fits the description based on the search results.
    
    If they are just searching for a specific location (e.g., "London"), return that location.
    
    Return ONLY a JSON object with "name" and "country".
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            country: { type: Type.STRING }
          },
          required: ["name", "country"]
        }
      }
    });

    const result = JSON.parse(response.text);
    const locs = await searchLocations(`${result.name}, ${result.country}`);
    const foundLoc = locs.length > 0 ? locs[0] : null;
    
    searchCache.set(normalizedQuery, foundLoc);
    return foundLoc;
  } catch (error: any) {
    // Check for rate limit error (429)
    const isRateLimit = error?.message?.includes("429") || error?.status === "RESOURCE_EXHAUSTED";
    
    if (isRateLimit) {
      // Set cooldown for 5 minutes
      aiCooldownUntil = Date.now() + (5 * 60 * 1000);
      console.warn("Gemini rate limit hit. AI search disabled for 5 minutes.");
    } else {
      console.error("Intelligent Search Error:", error);
    }
    
    return fallbackSearch();
  }
}
