import {migrate} from './migrate.js'
import {z} from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const envSchema = z.object({
  KOBO_SOURCE_URL: z.string(),
  KOBO_SOURCE_URLV1: z.string(),
  KOBO_SOURCE_TOKEN: z.string(),
  KOBO_DESTINATION_URL: z.string(),
  KOBO_DESTINATION_URLV1: z.string(),
  KOBO_DESTINATION_TOKEN: z.string(),
})
const env = envSchema.parse(process.env)

  await migrate({
    dryRun: true,
    filters: {
      submissionDateStart: new Date(2025, 0, 12),
      // formIdsIgnored: ['aLEGqicGyzkZCeCYeWqEyG', 'aJaGLvGEdpYWk5ift8k87y'],
      // formIds: ['aoJppKLX7QvSkMYokUfEjB'],
    },
    destination: {
      token: env.KOBO_DESTINATION_TOKEN,
    urlv1: env.KOBO_DESTINATION_URLV1,
    urlv2: env.KOBO_DESTINATION_URL,
  },
  source: {
    token: env.KOBO_SOURCE_TOKEN,
    urlv1: env.KOBO_SOURCE_URLV1,
    urlv2: env.KOBO_SOURCE_URL,
  },
})