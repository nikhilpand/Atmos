---
title: ATMOS Metadata Service
emoji: 📊
colorFrom: yellow
colorTo: yellow
sdk: docker
app_port: 7860
---

# ATMOS Metadata Service

TMDB enrichment and poster caching microservice.

## Features
- TMDB search with auto-detection (movie vs TV)
- Poster/backdrop proxy with in-memory LRU cache
- Bulk enrichment endpoint (up to 50 titles)
- 7-day result caching
