import { createClient } from '@sanity/client'

declare const process: {
  env: {
    [key: string]: string | undefined;
  };
};

export const client = createClient({
  projectId: '75fz8bzj',
  dataset: 'production',
  apiVersion: '2024-04-07',
  useCdn: false,
  token: process.env.SANITY_API_WRITE_TOKEN || process.env.SANITY_API_TOKEN || process.env.SANITY_API_READ_TOKEN,
})
