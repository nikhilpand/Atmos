import { makeProviders, makeStandardFetcher, targets } from '@movie-web/providers';

const fetcher = makeStandardFetcher(fetch);
const providers = makeProviders({
  fetcher,
  target: targets.ANY,
});

async function run() {
  const media = {
    type: 'movie',
    title: 'Inception',
    releaseYear: 2010,
    tmdbId: '27205',
    imdbId: 'tt1375666'
  };

  try {
    const res = await providers.runAll({
      media: media,
      sourceOrder: ['vidsrc', 'flixhq', 'superstream']
    });
    console.log(JSON.stringify(res, null, 2));
  } catch(e) {
    console.error(e);
  }
}

run();
