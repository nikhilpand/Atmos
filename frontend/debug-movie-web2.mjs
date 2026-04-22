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

  const p = providers;
  p.runAll({
    media,
    events: {
      init(e) {
        console.log("Init providers:", e.sourceIds);
      },
      start(id) {
        console.log(`[${id}] Starting...`);
      },
      update(e) {
        if (e.status === 'failed') console.log(`[${e.id}] Failed:`, e.reason);
        else if (e.status === 'success') console.log(`[${e.id}] Success!`);
      }
    }
  }).then(output => console.log("Final:", output));
}

run();
