# Privy
## Done — Feb 18 2026

- Emoji grid login/register UI with animated slots, username field, shake-on-error
- 4-emoji PIN hashed with Argon2id (hash-wasm / WASM) before storing in Supabase
- Supabase Edge Function handles `register` and `login`, deployed with `--no-verify-jwt`
- `public.users` table with `username` and `password_hash` (migration included)
- Frontend calls edge function via plain `fetch()` — no supabase-js client (avoids RN polyfill crashes)
- Fixed CORS: replaced `npm:argon2` (native C++, crashes Deno) with `npm:hash-wasm` (WebAssembly)
- Fixed Android bundling: added `babel.config.js` and `metro.config.js`
- Fixed web warnings: `useNativeDriver`, `shadow*` props, `pointerEvents`

- [x] Managing database migrations
- [x] Creating and deploying Supabase Functions
- [x] Generating types directly from your database schema
- [x] Making authenticated HTTP requests to [Management API](https://supabase.com/docs/reference/api/introduction)