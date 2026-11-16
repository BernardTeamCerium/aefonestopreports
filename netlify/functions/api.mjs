import { getStore } from '@netlify/blobs';
import { handle } from '../../src/api.mjs';

// Data and logins live in Netlify Blobs (persistent key-value storage on the site).
export default async (request, context) => {
  const blobs = getStore({ name: 'portal', consistency: 'strong' });
  const store = {
    get: key => blobs.get(key, { type: 'json' }),
    set: (key, value) => blobs.setJSON(key, value),
  };
  return handle(request, { store, env: process.env, ip: context.ip });
};

export const config = { path: '/api/*' };
