import { makeProviders, makeStandardFetcher, targets } from '@movie-web/providers';

const fetcher = makeStandardFetcher(fetch);
const providers = makeProviders({
  fetcher,
  target: targets.ANY,
});

async function run() {
  try {
    const res = await providers.runAll({
      media: {
        type: 'movie',
        title: 'Inception',
        releaseYear: 2010,
        tmdbId: '27205',
        imdbId: 'tt1375666'
      },
      sourceOrder: ['vidsrc', 'flixhq', 'gomovies']
    });
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error("Extraction failed:", e.message);
  }
}
run();
