import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log("Starting Atmos Server...");

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/weather", async (req, res) => {
    try {
      const { lat, lon } = req.query;

      if (!lat || !lon) {
        return res.status(400).json({ error: "Latitude and longitude are required." });
      }

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,weather_code,visibility,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&minutely_15=precipitation&timezone=auto`;
      
      console.log(`Fetching weather for ${lat}, ${lon}...`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Open-Meteo failed with status: ${response.status}`);
      }
      const data: any = await response.json();

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

      // Construct a response that matches the expected format in weatherService.ts
      const formattedData = {
        current: {
          Temperature: { Metric: { Value: data.current.temperature_2m } },
          WeatherText: "Atmospheric Condition", // Open-Meteo doesn't provide text, we'll use label from frontend
          WeatherIcon: currentCode,
          PrecipitationSummary: { Precipitation: { Metric: { Value: data.current.precipitation } } },
          UVIndex: data.hourly.uv_index[0] || 0,
          RelativeHumidity: data.current.relative_humidity_2m,
          DewPoint: { Metric: { Value: data.current.apparent_temperature } }, // Approximation
          Wind: { 
            Speed: { Metric: { Value: data.current.wind_speed_10m } },
            Direction: { Degrees: data.current.wind_direction_10m }
          },
          WindGust: { Speed: { Metric: { Value: data.current.wind_gusts_10m } } },
          Pressure: { Metric: { Value: data.current.pressure_msl } },
          Visibility: { Metric: { Value: data.hourly.visibility[0] / 1000 || 10 } }, 
        },
        hourly: data.hourly.time.map((time: string, i: number) => ({
          DateTime: time,
          Temperature: { Value: data.hourly.temperature_2m[i] },
          WeatherIcon: mapWeatherCode(data.hourly.weather_code[i], true)
        })),
        daily: {
          DailyForecasts: data.daily.time.map((time: string, i: number) => ({
            Date: time,
            Temperature: {
              Maximum: { Value: data.daily.temperature_2m_max[i] },
              Minimum: { Value: data.daily.temperature_2m_min[i] }
            },
            Day: { 
              Icon: mapWeatherCode(data.daily.weather_code[i], true),
              PrecipitationProbability: data.daily.precipitation_probability_max[i]
            },
            Night: { 
              Icon: mapWeatherCode(data.daily.weather_code[i], false),
              PrecipitationProbability: data.daily.precipitation_probability_max[i]
            }
          }))
        },
        astronomy: {
          sunrise: data.daily.sunrise[0],
          sunset: data.daily.sunset[0],
          moonPhase: getMoonPhase(new Date()),
          stargazingIndex: Math.max(0, 100 - (data.current.cloud_cover || 0)), // Simple index based on cloud cover
          uvIndexMax: data.daily.uv_index_max[0] || 0
        },
        minutely: {
          time: data.minutely_15.time,
          precipitation: data.minutely_15.precipitation
        },
        location: {
          EnglishName: "Current Location",
          Country: { EnglishName: "Region" }
        }
      };

      res.json(formattedData);

    } catch (error: any) {
      console.error("Weather API Error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch weather data" });
    }
  });

  app.get("/api/locations", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.status(400).json({ error: "Query is required" });

      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q as string)}&format=json&limit=5`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'AtmosWeatherApp/1.0'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Nominatim failed with status: ${response.status}`);
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Locations API Error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch locations" });
    }
  });

  app.get("/api/air-quality", async (req, res) => {
    try {
      const { lat, lon } = req.query;
      if (!lat || !lon) return res.status(400).json({ error: "Lat/Lon required" });

      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Air Quality API failed with status: ${response.status}`);
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Air Quality API Error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch air quality" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
