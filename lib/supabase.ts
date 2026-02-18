// ─── Supabase project config ─────────────────────────────────────────────────
const SUPABASE_URL  = 'https://roqqrtbohtqadmkhgffr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvcXFydGJvaHRxYWRta2hnZmZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Mjk1OTQsImV4cCI6MjA4NzAwNTU5NH0.ZQgXA6cp1m3HMp9ENsEmuF_HsKYgCWb-nfM6FyoD-Pc';
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// ─── Types ────────────────────────────────────────────────────────────────────
export type AuthAction = 'register' | 'login';

export interface AuthPayload {
  action:   AuthAction;
  username: string;
  emojiKey: string[];
}

export interface AuthResult {
  success: boolean;
  action:  AuthAction;
  user:    { id: string; username: string; created_at: string };
}

/**
 * Call the Supabase `auth` edge function via plain fetch.
 * No library needed — avoids all React Native polyfill issues.
 */
export async function callAuthFunction(payload: AuthPayload): Promise<AuthResult> {
  const response = await fetch(`${FUNCTIONS_URL}/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json?.error ?? `Server error ${response.status}`);
  }

  return json as AuthResult;
}
