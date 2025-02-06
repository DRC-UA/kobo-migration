import {migrate} from './migrate.js'

await migrate({
  dryRun: false,
  filters: {
    submissionDateStart: new Date(2025, 0, 1),
    submissionDateEnd: new Date(2025, 1, 1),
    formIds: ['aoJppKLX7QvSkMYokUfEjB'],
    offset: 10,
    take: 1000,
  },
  destination: {
    token: '...',
    urlv1: 'https://kc-eu.kobotoolbox.org',
    urlv2: 'https://eu.kobotoolbox.org',
  },
  source: {
    token: '...',
    urlv1: 'https://kc.kobotoolbox.org',
    urlv2: 'https://kf.kobotoolbox.org',
  },
})