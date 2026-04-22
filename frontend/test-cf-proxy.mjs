import { makeProviders, makeSimpleProxyFetcher, targets } from '@movie-web/providers';

const PROXY_URL = 'https://atmos-proxy.nikhilpand-393.workers.dev/'; // From previous session

const providers = makeProviders({
  fetcher: makeSimpleProxyFetcher(PROXY_URL, fetch),
  target: targets.NATIVE,
});

async function run() {
  const media = {
    type: 'show',
    title: 'The Boys',
    releaseYear: 2019,
    tmdbId: '76479',
    season: { number: 1, tmdbId: '' },
    episode: { number: 1, tmdbId: '' }
  };

  console.log("Running extraction with CF Proxy...");
  try {
    const output = await providers.runAll({ media });
    console.log("Output:", JSON.stringify(output, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
