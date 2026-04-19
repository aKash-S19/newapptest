# Privy

A private, end-to-end encrypted messaging app built with Expo (React Native) and Supabase.

Contribution note: land small docs/chore updates on main regularly to keep the GitHub contribution graph active (green).

---

## Changelog

### Apr 19 2026 — Major Calls Update, Group Reliability & APK Readiness

- Added full 1:1 call signaling pipeline through edge actions:
	- `send-call-signal`, `get-call-signals`, `get-pending-call-signals`, `ack-call-signals`
	- encrypted offer/answer/ICE payload relay and reachability checks before ringing
- Added call UI and call entry flow:
	- dedicated call route/screen (`app/call/[chatId].tsx`)
	- in-chat call button and incoming-call accept/decline prompts
	- call timeout/end handling and call event logging
- Added verified call history events in chat:
	- backend action `log-call-event` stores call event markers (`application/x-privy-call-event`)
	- direct chat and chats list now render human-readable call previews instead of raw JSON payloads
- Upgraded incoming call notifications:
	- call category/actions, ringtone-oriented Android channel audio usage, sticky/time-sensitive behavior
	- tap handling supports call routing and decline action filtering
- Improved delivery speed and backend efficiency:
	- faster polling intervals for direct chat, group chat, chats list and global notification bridge
	- `get-chats`/`get-groups-overview` optimized with bounded recent scans + fallback latest-message lookup
	- unread-count work for push metadata parallelized in direct/group send flows
- Added push token lifecycle support and dispatch hardening:
	- register/unregister device push token actions
	- token validation, deduplication, inactive-token cleanup (`DeviceNotRegistered`)
- Fixed group key recovery and group open reliability:
	- auto-rekey fallback for admin on group-key decrypt mismatch (`invalid ghash tag`)
	- admin re-wrap sync for all members to heal stale key rows
	- added transient gateway retry/fallback handling for group context fetch
- App identity/build updates:
	- mobile app display name now `Privy`
	- added EAS `apk` profile for installable Android builds

### Apr 19 2026 — Groups, Notifications, Privacy Controls & Git Hygiene

- Added full group chat surfaces and navigation:
	- new groups tab UI (`app/(tabs)/groups.tsx`)
	- group chat screen (`app/chat/group/[id].tsx`)
	- group info/admin screen (`app/chat/group/info.tsx`)
- Added admin/member group lifecycle controls:
	- add/remove members, promote/demote role
	- archive/delete group and permanent destroy group actions
	- join via invite code and invite-link generation
- Added group media management:
	- group avatar/banner upload via signed Supabase storage URLs
	- group context and overview APIs for list/detail rendering
- Improved app-wide notification behavior:
	- centralized direct/group message notification pipeline
	- route-aware duplicate suppression when active chat is open
	- Expo Go-safe notification fallback handling in `lib/notifications.ts`
- Expanded user settings and sync:
	- notification sound + group mute controls
	- chat customizations and server-sync support for settings
- Strengthened auth/session handling in edge function:
	- PBKDF2-based PIN hashing and legacy-hash upgrade path
	- hashed session/device identifiers and stricter payload validation
	- wider authenticated action coverage for groups/chats/settings
- Added and organized Supabase migrations for groups, settings, invite links, username history, auth hardening, and group-key table repair under `supabase/migrations/`
- Updated `.gitignore` to exclude local-only artifacts and confidential/noise files while keeping source and migrations tracked

### Apr 18 2026 — Production Security Hardening

- Moved active group/request data flows to edge-function actions (client no longer performs direct `public.*` table reads/writes for these paths)
- Replaced direct Postgres changefeed dependencies with secure polling + broadcast-only events where needed
- Added new auth edge actions for:
	- group overview/detail/member management
	- group request moderation (accept/decline/report)
	- group key bootstrap/upsert for E2EE distribution
	- incremental message polling support
- Added migration `20260418000002_lock_active_app_tables.sql` to enforce:
	- `ENABLE RLS` + `FORCE RLS`
	- revoked `anon`/`authenticated` table privileges on active app tables
	- `service_role_all` policy for edge-function access
- Removed hardcoded Supabase defaults from `app.config.js`; release builds now require env vars
- Set Android hardening flags in `app.json`:
	- `allowBackup: false`
	- `usesCleartextTraffic: false`

### Release Checklist (Play Store)

1. Set env vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) for build/runtime config.
2. Push migrations to production:
	 - `npx supabase db push --yes`
3. Deploy edge auth function:
	 - `npx supabase functions deploy auth --project-ref <project-ref> --no-verify-jwt`
4. Run smoke tests for register/login, direct chat send, group chat send, request accept/decline/report.
5. Build signed Android release via EAS and submit to Play Console.

### Quick APK Build (Internal Testing)

1. Ensure EAS auth is active: `npx eas whoami`
2. Build installable APK: `npx eas build -p android --profile apk`
3. Download the APK from the build URL shown by EAS and install on device.

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