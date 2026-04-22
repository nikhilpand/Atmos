import { makeProviders, makeStandardFetcher, targets } from '@movie-web/providers';
const providers = makeProviders({ fetcher: makeStandardFetcher(fetch), target: targets.NATIVE });
console.log(providers.listSources().map(p => p.id));
