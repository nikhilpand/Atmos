import { GoogleGenAI, Type } from "@google/genai";
import { Location, WeatherData, getWindDirection } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Simple in-memory cache for intelligent search results
const searchCache = new Map<string, Location | null>();
let aiCooldownUntil = 0;

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  let response;
  try {
    // Direct call to Open-Meteo for static hosting compatibility
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,weather_code,visibility,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&minutely_15=precipitation&timezone=auto`;
    response = await fetch(url);
  } catch (e) {
    throw new Error(`Network error: Failed to connect to weather API. ${e instanceof Error ? e.message : ''}`);
  }
  
  if (!response.ok) {
    throw new Error('Failed to fetch weather data');
  }

  const data = await response.json();

  // Map Open-Meteo weather codes to AccuWeather-style codes used in the frontend
  const mapWeatherCode = (code: number, isDay: boolean) => {
    if (code === 0) return isDay ? 1 : 33; // Clear
    if (code === 1 || code === 2) return isDay ? 2 : 34; // Mostly Sunny / Clear
    if (code === 3) return isDay ? 7 : 38; // Cloudy
    if (code >= 45 && code <= 48) return 11; // Fog
    if (code >= 51 && code <= 55) return 12; // Drizzle/Showers
    if (code >= 56 && code <= 57) return 26; // Freezing Drizzle
    if (code >= 61 && code <= 65) return 18; // Rain
    if (code >= 66 && code <= 67) return 26; // Freezing Rain
    if (code >= 71 && code <= 77) return 22; // Snow
    if (code >= 80 && code <= 82) return 12; // Rain Showers
    if (code >= 85 && code <= 86) return 22; // Snow Showers
    if (code >= 95) return 15; // Thunderstorm
    return isDay ? 1 : 33;
  };

  const isDay = data.current.is_day === 1;
  const currentCode = mapWeatherCode(data.current.weather_code, isDay);

  // Simple moon phase calculation
  const getMoonPhase = (date: Date) => {
    const lp = 2551443 * 1000; 
    const now = date.getTime();
    const new_moon = new Date('1970-01-07T20:35:00Z').getTime();
    const phase = ((now - new_moon) % lp) / lp;
    return phase; // 0 to 1
  };

  // Fetch Air Quality Data directly
  let airQuality;
  try {
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone`;
    const aqRes = await fetch(aqUrl);
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
      temp: Math.round(data.current.temperature_2m),
      condition: "Atmospheric Condition", 
      conditionCode: currentCode,
      precipitation: data.current.precipitation || 0,
      uvIndex: data.hourly.uv_index[0] || 0,
      humidity: data.current.relative_humidity_2m || 0,
      dewPoint: Math.round(data.current.apparent_temperature || 0),
      windSpeed: Math.round(data.current.wind_speed_10m || 0),
      windDirection: getWindDirection(data.current.wind_direction_10m || 0),
      gusts: Math.round(data.current.wind_gusts_10m || 0),
      pressure: Math.round(data.current.pressure_msl || 0),
      visibility: Math.round(data.hourly.visibility[0] / 1000 || 10),
    },
    airQuality,
    hourly: {
      time: data.hourly.time,
      temp: data.hourly.temperature_2m.map((t: number) => Math.round(t)),
      conditionCode: data.hourly.weather_code.map((c: number) => mapWeatherCode(c, true)),
    },
    daily: {
      time: data.daily.time,
      tempMax: data.daily.temperature_2m_max.map((t: number) => Math.round(t)),
      tempMin: data.daily.temperature_2m_min.map((t: number) => Math.round(t)),
      conditionCode: data.daily.weather_code.map((c: number) => mapWeatherCode(c, true)),
      precipitationProbability: data.daily.precipitation_probability_max,
    },
    astronomy: {
      sunrise: data.daily.sunrise[0],
      sunset: data.daily.sunset[0],
      moonPhase: getMoonPhase(new Date()),
      stargazingIndex: Math.max(0, 100 - (data.current.cloud_cover || 0)),
      uvIndexMax: data.daily.uv_index_max[0] || 0
    },
    minutely: {
      time: data.minutely_15.time,
      precipitation: data.minutely_15.precipitation
    },
  };
}

export async function searchLocations(query: string): Promise<Location[]> {
  if (!query) return [];
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'AtmosWeatherApp/1.0'
      }
    });
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
