const { makeProviders, makeStandardFetcher, targets } = require('@movie-web/providers');

const fetcher = makeStandardFetcher(fetch);
const providers = makeProviders({
  fetcher,
  target: targets.ANY
});

async function main() {
  try {
    const stream = await providers.runAll({
      media: {
        type: 'movie',
        title: 'Inception',
        tmdbId: '27205',
        releaseYear: 2010
      }
    });
    console.log(JSON.stringify(stream, null, 2));
  } catch (e) {
    console.error(e);
  }
}
main();
