#!/bin/bash
echo "=== Scanning NEW providers (not already in our list) ==="
declare -A URLS
# Batch 1: Known alternatives
URLS[embedflix]="https://embedflix.net/movie/27205"
URLS[player_smashy]="https://player.smashy.stream/movie/27205"
URLS[vidsrc_to]="https://vidsrc.to/embed/movie/27205"
URLS[vidsrc_net]="https://vidsrc.net/embed/movie/?tmdb=27205"
URLS[gomovies]="https://gomovies.sx/movie/watch-inception-27205"
URLS[flixhq]="https://flixhq.to/movie/watch-inception-27205"
URLS[catflix]="https://catflix.su/movie/27205"
URLS[primeflix]="https://primeflix.lol/movie/27205"
URLS[filmxy]="https://www.filmxy.pw/embed/27205"
URLS[dbgo]="https://dbgo.fun/imdb.php?id=tt1375666"
URLS[soapertv]="https://soaper.tv/movie/27205"
URLS[movie_e]="https://movie-e.tv/embed/movie/27205"
URLS[wecima]="https://wecima.show/embed/27205"
URLS[myflixer]="https://myflixerz.to/movie/27205"
URLS[putlocker]="https://ww7.putlocker.vip/embed/movie/27205"
URLS[lookmovie]="https://lookmovie2.to/movies/view/27205"
URLS[moviee]="https://moviee.tv/embed/movie/27205"
URLS[vidsrc_pro]="https://vidsrc.pro/embed/movie/27205"
URLS[vidsrc_stream]="https://vidsrc.stream/embed/movie/27205"
URLS[embedme]="https://embedme.top/embed/movie/27205"
URLS[flicky_host]="https://flicky.host/embed/movie/?id=27205"
URLS[embed_to]="https://www.embed.to/embed/movie/27205"
URLS[rivestream]="https://rivestream.live/embed?type=movie&id=27205"
URLS[neoembed]="https://neoembed.com/embed/movie/27205"
URLS[su_embed]="https://su.embed.cc/embed/movie/27205"
URLS[vidsrc_uk]="https://vidsrc.uk/embed/movie/27205"
URLS[onionflix]="https://onionflix.com/embed/movie/27205"
URLS[novastream]="https://novastream.top/embed/movie/27205"

for name in $(echo "${!URLS[@]}" | tr ' ' '\n' | sort); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 -L "${URLS[$name]}" 2>/dev/null)
  if [ "$code" = "200" ]; then
    size=$(curl -s -L --max-time 6 "${URLS[$name]}" 2>/dev/null | wc -c)
    time=$(curl -s -o /dev/null -w "%{time_total}" --max-time 6 -L "${URLS[$name]}" 2>/dev/null)
    echo "✅ $name: $code | ${time}s | ${size} bytes"
  elif [ "$code" = "000" ]; then
    echo "💀 $name: DEAD"
  else
    echo "❌ $name: $code"
  fi
done
