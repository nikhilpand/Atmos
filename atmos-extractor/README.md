---
title: Atmos Stream Extractor
emoji: 🎬
colorFrom: purple
colorTo: indigo
sdk: docker
pinned: true
short_description: Headless Chromium stream URL extractor for Atmos
---

# Atmos Stream Extractor

Playwright-powered headless Chromium microservice that intercepts real `.m3u8` and `.mp4` stream URLs from streaming provider embed pages.

## Endpoints

- `GET /health` — Liveness check
- `GET /extract?url={embedUrl}` — Extract stream from any embed URL  
- `GET /extract/tmdb?id={tmdbId}&type={movie|tv}&season={s}&episode={e}` — Auto-try all providers
