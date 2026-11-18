# OVERCLOCK — Daily Hardware & Circuit Arcade for Reddit

A daily hardware-themed puzzle and arcade game built on **Devvit Web** (`@devvit/web`, `@devvit/start`, `@devvit/analytics`) for `r/OverclockArcade`.

## Modules & Modes

- **5 Hardware Modules:** `CPU`, `MOBO`, `RAM`, `SSD`, and `GPU` (Tron-style Light Cycle run)
- **Game Modes:** `Story` (`Easy`, `Normal`, `Hard`), `Daily` (once per day per module), `Challenge`, `Overclock`, and `Blitz`
- **Reddit Integration:** Daily scheduled posts, Redis leaderboards & streaks, comment result sharing, and Devvit Journeys analytics

## Project Structure

- `devvit.json` — Devvit Web entrypoints (`default` inline splash, `game` expanded view), server config, moderator menu item, and permissions.
- `src/shared/` — Deterministic puzzle generator, exact PAR solver, and shared client/server types.
- `src/server/` — Devvit Express backend (`GET /api/init`, `POST /api/complete`, `POST /api/comment-result`, `POST /internal/menu/post-create`, Redis leaderboards & streaks, Devvit Journeys telemetry router).
- `src/client/` — Inline splash card (`splash.tsx`) and 2.5D Canvas puzzle app (`App.tsx`, `isoRenderer.ts`).

## Commands

- `npm run dev` — Start Devvit playtest on your test subreddit (`devvit playtest`)
- `npm run build` — Build client (`dist/client`) and server (`dist/server`) bundles
- `npm run lint` — Run TypeScript typechecking (`tsc --noEmit`)
- `npm run deploy` — Upload a new app version to Reddit (`devvit upload`)
