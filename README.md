# Privy

A private, end-to-end encrypted messaging app built with Expo (React Native) and Supabase.

Contribution note: land small docs/chore updates on main regularly to keep the GitHub contribution graph active (green).

---

## Changelog

### Mar 20 2026 — Group Chat Launch, Stability Fixes, and UI Refresh

#### Group Chat Backend (Supabase + Edge Function)
- Added full group chat foundation: groups, memberships, roles, bans, invite links, join requests, key envelopes, key rotations, group messages, receipts, typing presence, and reports
- Extended `supabase/functions/auth/index.ts` with group actions:
	- create/list groups
	- create/join invites and join-request approval flow
	- member management (add, set role, mute, kick, ban)
	- group settings (announcement mode, invite approval, forwarding restriction)
	- rotate group key, fetch group state, send/get messages, typing and receipt updates, report user
- Added schema-cache resiliency:
	- explicit `reload-schema-cache` edge action
	- best-effort schema reload calls before group actions
	- retry path for transient PostgREST cache misses

#### New/Updated Migrations
- `20260320090000_group_chat_foundation.sql`
- `20260320093000_reload_postgrest_schema.sql`
- `20260320094000_reload_schema_cache_fn.sql`
- `20260320101000_group_tables_backfill.sql`

#### Client Group E2EE and Reliability
- Added `lib/group-e2ee.ts` for group key generation, envelope encryption/decryption, and local key persistence
- Fixed SecureStore key format compatibility on Android (only allowed key characters)
- Added safe fallback handling to avoid SecureStore crashes from legacy/invalid key names
- Enhanced `lib/supabase.ts` auth-function caller with schema-cache aware retry + reload fallback

#### Group UI (Modernized)
- Added `app/(tabs)/groups.tsx` with:
	- modern hero section and quick action pills
	- create-group and join-by-link flows
	- improved group list rows, empty states, and unread indicators
- Added `app/group/[id].tsx` with:
	- cleaner messenger-style header and chat layout
	- refined bubble styling and timestamps
	- keyboard-safe multiline composer
	- collapsible admin tools panel
- Routing updates:
	- groups tab in `app/(tabs)/_layout.tsx`
	- group chat stack screen in `app/_layout.tsx`

#### Operational Notes
- Supabase migrations pushed and `auth` function deployed successfully
- For Expo cache reset + tunnel startup, use:
	- `npx expo start -c --tunnel`

### Mar 7 2026 — E2EE Chat, File Sharing, Onboarding & More

#### End-to-End Encrypted Chat (`app/chat/[id].tsx`, `lib/e2ee.ts`)
- Full E2EE chat screen with AES-256-GCM encryption via `@noble/ciphers`
- ECDH key exchange using `@noble/curves` — shared key derived on device, never leaves it
- Realtime message delivery via Supabase Realtime subscriptions
- Typing indicators, read receipts, message status ticks (sent / delivered / read)
- Unread badge count, date separators, empty state
- Image viewer with pinch-to-zoom, save to camera roll, forward to chat

#### File & Media Sharing
- **Camera**: take a photo and send it instantly (E2EE, original quality)
- **Gallery**: pick images at full resolution — no compression
- **Documents**: pick any file (PDF, Word, Excel, ZIP, etc.) via `expo-document-picker`
- All files encrypted before upload, decrypted on the receiver's device
- **Attach tray**: `+` button opens Camera / Gallery / Document picker
- **Telegram-style file bubble**: shows filename, size, type (e.g. `1.4 MB · PDF`), loading status and download icon
- Open/save received files via `expo-sharing` share sheet — "Save to Downloads" on Android, "Save to Files" on iOS (no SAF writability errors)

#### Delete for Me / Delete for Everyone
- Long-press any message → context menu
- **Delete for me**: removes message from local state only
- **Delete for everyone**: calls Supabase Edge Function to delete the DB row, broadcasts a `message_deleted` Realtime event so all devices remove it instantly
- Added `REPLICA IDENTITY FULL` on the messages table so Realtime DELETE events carry the full row payload

#### Animated Onboarding (`app/onboarding.tsx`)
- Shown once on very first launch, skipped for returning users (flag stored in `SecureStore`)
- 5 slides with per-slide accent color themes (purple, amber, green, blue, red)
- Reanimated-powered: cards scale + fade as they slide into view
- Pill badge, decorative icon rings, expanding dot indicators, spring-animated CTA button
- Slides: End-to-End Encrypted · Emoji-PIN Login · Original Quality Media · Private Friend Network · Realtime & Reliable

#### Friend Requests (`app/requests.tsx`)
- Send, receive, accept and decline friend requests by username
- Friends list with avatar and online status
- DB migrations: `friend_requests`, `user_profile`, `avatars_storage`

#### Push Notifications (`lib/notifications.ts`)
- Expo push token registered on login
- Tap a notification to deep-link directly into the relevant chat

#### Infrastructure & Tooling
- `lib/responsive.ts` — tablet / small-phone layout helpers, `CONTENT_MAX_WIDTH`
- `hooks/use-app-theme.ts` — single source of truth for all color tokens (dark mode + accent color)
- `lib/e2ee.ts` — `encryptMessage` / `decryptMessage` with random IV per message
- Updated `.gitignore`: swap files (`*.swp`), editor dirs (`.idea/`, `.vscode/`), logs

---

### Feb 18 2026 — Auth Foundation

- Emoji grid login/register UI with animated slots, username field, shake-on-error
- 6-emoji PIN hashed with Argon2id (`hash-wasm` WebAssembly) before storing in Supabase
- Supabase Edge Function handles `register` and `login`, deployed with `--no-verify-jwt`
- `public.users` table with `username` and `password_hash` (migration `20260218000000`)
- Frontend calls edge function via `fetch()` — no supabase-js client (avoids RN polyfill crashes)
- Fixed CORS: replaced `npm:argon2` (native C++, crashes Deno) with `npm:hash-wasm`
- Fixed Android bundling: `babel.config.js` and `metro.config.js`
- Fixed web warnings: `useNativeDriver`, `shadow*` props, `pointerEvents`

---

## Tech Stack

| Layer | Library |
|---|---|
| Framework | Expo SDK ~54, expo-router ~6 |
| Language | TypeScript |
| Encryption | `@noble/ciphers` (AES-256-GCM), `@noble/curves` (ECDH P-256) |
| Backend | Supabase (Postgres + Realtime + Edge Functions + Storage) |
| Auth | Custom emoji-PIN, Argon2id hash via `hash-wasm` |
| Animations | `react-native-reanimated` ~4, `Animated` API |
| Fonts | Inter (400 / 500 / 600 / 700) via `@expo-google-fonts` |
| Notifications | `expo-notifications` |
| File picking | `expo-document-picker`, `expo-image-picker` |
| File sharing | `expo-sharing`, `expo-media-library` |