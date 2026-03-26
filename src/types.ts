export interface WeatherData {
  current: {
    temp: number;
    condition: string;
    conditionCode: number;
    precipitation: number;
    uvIndex: number;
    humidity: number;
    dewPoint: number;
    windSpeed: number;
    windDirection: string;
    gusts: number;
    pressure: number;
    visibility: number;
  };
  airQuality?: {
    aqi: number;
    pm10: number;
    pm2_5: number;
    carbonMonoxide: number;
    nitrogenDioxide: number;
    ozone: number;
  };
  hourly: {
    time: string[];
    temp: number[];
    conditionCode: number[];
  };
  daily: {
    time: string[];
    tempMax: number[];
    tempMin: number[];
    conditionCode: number[];
    precipitationProbability: number[];
  };
  astronomy?: {
    sunrise: string;
    sunset: string;
    moonPhase: number;
    stargazingIndex: number;
    uvIndexMax: number;
  };
  minutely?: {
    time: string[];
    precipitation: number[];
  };
}

export interface Location {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

export const WEATHER_CONDITIONS: Record<number, { label: string; icon: string; isRainy?: boolean; isStormy?: boolean; isSnowy?: boolean }> = {
  1: { label: 'Sunny', icon: 'wb_sunny' },
  2: { label: 'Mostly Sunny', icon: 'wb_sunny' },
  3: { label: 'Partly Sunny', icon: 'partly_cloudy_day' },
  4: { label: 'Intermittent Clouds', icon: 'partly_cloudy_day' },
  5: { label: 'Hazy Sunshine', icon: 'foggy' },
  6: { label: 'Mostly Cloudy', icon: 'cloud' },
  7: { label: 'Cloudy', icon: 'cloud' },
  8: { label: 'Dreary (Overcast)', icon: 'cloud' },
  11: { label: 'Fog', icon: 'foggy' },
  12: { label: 'Showers', icon: 'rainy', isRainy: true },
  13: { label: 'Mostly Cloudy w/ Showers', icon: 'rainy', isRainy: true },
  14: { label: 'Partly Sunny w/ Showers', icon: 'rainy', isRainy: true },
  15: { label: 'T-Storms', icon: 'thunderstorm', isStormy: true },
  16: { label: 'Mostly Cloudy w/ T-Storms', icon: 'thunderstorm', isStormy: true },
  17: { label: 'Partly Sunny w/ T-Storms', icon: 'thunderstorm', isStormy: true },
  18: { label: 'Rain', icon: 'rainy', isRainy: true },
  19: { label: 'Flurries', icon: 'ac_unit', isSnowy: true },
  20: { label: 'Mostly Cloudy w/ Flurries', icon: 'ac_unit', isSnowy: true },
  21: { label: 'Partly Sunny w/ Flurries', icon: 'ac_unit', isSnowy: true },
  22: { label: 'Snow', icon: 'ac_unit', isSnowy: true },
  23: { label: 'Mostly Cloudy w/ Snow', icon: 'ac_unit', isSnowy: true },
  24: { label: 'Ice', icon: 'ac_unit', isSnowy: true },
  25: { label: 'Sleet', icon: 'ac_unit', isSnowy: true },
  26: { label: 'Freezing Rain', icon: 'rainy', isRainy: true },
  29: { label: 'Rain and Snow', icon: 'rainy', isRainy: true, isSnowy: true },
  30: { label: 'Hot', icon: 'wb_sunny' },
  31: { label: 'Cold', icon: 'ac_unit' },
  32: { label: 'Windy', icon: 'air' },
  33: { label: 'Clear', icon: 'clear_night' },
  34: { label: 'Mostly Clear', icon: 'clear_night' },
  35: { label: 'Partly Cloudy', icon: 'partly_cloudy_night' },
  36: { label: 'Intermittent Clouds', icon: 'partly_cloudy_night' },
  37: { label: 'Hazy Moonlight', icon: 'foggy' },
  38: { label: 'Mostly Cloudy', icon: 'cloud' },
  39: { label: 'Partly Cloudy w/ Showers', icon: 'rainy', isRainy: true },
  40: { label: 'Mostly Cloudy w/ Showers', icon: 'rainy', isRainy: true },
  41: { label: 'Partly Cloudy w/ T-Storms', icon: 'thunderstorm', isStormy: true },
  42: { label: 'Mostly Cloudy w/ T-Storms', icon: 'thunderstorm', isStormy: true },
  43: { label: 'Mostly Cloudy w/ Flurries', icon: 'ac_unit', isSnowy: true },
  44: { label: 'Mostly Cloudy w/ Snow', icon: 'ac_unit', isSnowy: true }
};

export function getWindDirection(degree: number): string {
  const directions = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  return directions[Math.round(degree / 45) % 8];
}
