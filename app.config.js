// app.config.js — reads from .env and injects values via expo-constants `extra`
const appJson = require('./app.json');

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env: set SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_/EXPO_PUBLIC_ equivalents).');
}

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      supabaseUrl,
      supabaseAnonKey,
    },
  },
};
