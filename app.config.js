// app.config.js — reads from .env and injects values via expo-constants `extra`
const fs = require('fs');
const path = require('path');
const appJson = require('./app.json');

const DEFAULT_SUPABASE_URL = 'https://roqqrtbohtqadmkhgffr.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvcXFydGJvaHRxYWRta2hnZmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Mjk1OTQsImV4cCI6MjA4NzAwNTU5NH0.ZQgXA6cp1m3HMp9ENsEmuF_HsKYgCWb-nfM6FyoD-Pc';
const DEFAULT_TURN_URLS = 'turn:openrelay.metered.ca:80,turns:openrelay.metered.ca:443?transport=tcp';
const DEFAULT_TURN_USERNAME = 'openrelayproject';
const DEFAULT_TURN_CREDENTIAL = 'openrelayproject';

function hydrateEnvFromDotenv(fileName = '.env') {
  const envPath = path.join(__dirname, fileName);
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) return;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  });
}

hydrateEnvFromDotenv();

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  DEFAULT_SUPABASE_URL;

const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_ANON_KEY;

const turnUrls =
  process.env.TURN_URLS ||
  process.env.EXPO_PUBLIC_TURN_URLS ||
  DEFAULT_TURN_URLS;

const turnUsername =
  process.env.TURN_USERNAME ||
  process.env.EXPO_PUBLIC_TURN_USERNAME ||
  DEFAULT_TURN_USERNAME;

const turnCredential =
  process.env.TURN_CREDENTIAL ||
  process.env.EXPO_PUBLIC_TURN_CREDENTIAL ||
  DEFAULT_TURN_CREDENTIAL;

const easProjectId =
  process.env.EAS_PROJECT_ID ||
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  'd0c8fc2e-a28c-4958-8d2a-eaa32660d674';

const androidPackage =
  process.env.ANDROID_PACKAGE ||
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE ||
  'com.akash.newapptest';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env: set SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_/EXPO_PUBLIC_ equivalents).');
}

module.exports = {
  expo: {
    ...appJson.expo,
    android: {
      ...(appJson.expo.android ?? {}),
      package: androidPackage,
    },
    extra: {
      supabaseUrl,
      supabaseAnonKey,
      turnUrls,
      turnUsername,
      turnCredential,
      eas: {
        projectId: easProjectId,
      },
    },
  },
};
