import { makeProviders, makeStandardFetcher, targets } from '@movie-web/providers';

const providers = makeProviders({
  fetcher: makeStandardFetcher(fetch),
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

  console.log("Running extraction for The Boys S1E1...");
  try {
    const output = await providers.runAll({ media });
    console.log("Output:", JSON.stringify(output, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
