#!/bin/bash
# Test all providers with a known movie (Inception TMDB 27205)
echo "=== Provider Health Check ==="
declare -A URLS
URLS[vidlink]="https://vidlink.pro/movie/27205"
URLS[vidsrc_icu]="https://vidsrc.icu/embed/movie/27205"
URLS[videasy]="https://player.videasy.net/movie/27205"
URLS[nontongo]="https://nontongo.win/embed/movie/27205"
URLS[vidjoy]="https://vidjoy.pro/embed/movie/27205"
URLS[vidfast]="https://vidfast.pro/movie/27205"
URLS[autoembed]="https://autoembed.co/movie/tmdb/27205"
URLS[2embed]="https://www.2embed.cc/embed/27205"
URLS[moviesapi]="https://moviesapi.club/movie/27205"
URLS[vidsrc_xyz]="https://vidsrc.xyz/embed/movie/27205"
URLS[vidsrc_me]="https://vidsrc.me/embed/movie?tmdb=27205"
URLS[embed_su]="https://embed.su/embed/movie/27205"
URLS[vidsrc_cc]="https://vidsrc.cc/v2/embed/movie/27205"
URLS[multiembed]="https://multiembed.mov/?video_id=27205&tmdb=1"
URLS[vidsrc_in]="https://vidsrc.in/embed/movie/27205"
# New providers to test
URLS[embedsu_v2]="https://embed.su/embed/movie/27205"
URLS[vidsrc_wtf]="https://vidsrc.wtf/api/3/movie/?id=27205"
URLS[111movies]="https://111movies.com/movie/27205"
URLS[vidplay]="https://vidplay.lol/e/27205"
URLS[superembed]="https://multiembed.mov/directstream.php?video_id=27205&tmdb=1"
URLS[vidsrc_nl]="https://player.vidsrc.nl/embed/movie/27205"
URLS[vidora]="https://vidora.su/embed/movie/27205"
URLS[rive]="https://rivestream.xyz/embed?type=movie&id=27205"
URLS[smashystream]="https://player.smashy.stream/movie/27205"
URLS[vidsrc_dev]="https://vidsrc.dev/embed/movie/27205"
URLS[frembed]="https://frembed.pro/api/film.php?id=27205"
URLS[cinescrape]="https://cinescrape.com/movie/27205"
URLS[warezcdn]="https://embed.warezcdn.com/filme/27205"

for name in "${!URLS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -L "${URLS[$name]}" 2>/dev/null)
  time=$(curl -s -o /dev/null -w "%{time_total}" --max-time 5 -L "${URLS[$name]}" 2>/dev/null)
  if [ "$code" = "200" ]; then
    echo "✅ $name: $code (${time}s)"
  elif [ "$code" = "000" ]; then
    echo "💀 $name: TIMEOUT/DNS"
  else
    echo "❌ $name: $code (${time}s)"
  fi
done
