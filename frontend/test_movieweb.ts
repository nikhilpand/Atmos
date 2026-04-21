import { makeProviders, makeStandardFetcher, targets } from '@movie-web/providers';

const providers = makeProviders({
  fetcher: makeStandardFetcher(fetch),
  target: targets.NATIVE,
});

async function test() {
  console.log("Searching...");
  try {
    const media = {
      type: 'movie' as const,
      title: 'Inception',
      releaseYear: 2010,
      tmdbId: '27205'
    };

    const result = await providers.runAll({
      media: media,
      events: {
        update(context) {
          console.log(`Provider update:`, context.id, context.status, context.reason || "");
        }
      }
    });

    console.log("Success!", result);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
