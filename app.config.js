// app.config.js — reads from .env and injects values via expo-constants `extra`
const appJson = require('./app.json');

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      supabaseUrl:
        process.env.SUPABASE_URL ||
        'https://roqqrtbohtqadmkhgffr.supabase.co',
      supabaseAnonKey:
        process.env.SUPABASE_ANON_KEY ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvcXFydGJvaHRxYWRta2hnZmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Mjk1OTQsImV4cCI6MjA4NzAwNTU5NH0.ZQgXA6cp1m3HMp9ENsEmuF_HsKYgCWb-nfM6FyoD-Pc',
    },
  },
};
