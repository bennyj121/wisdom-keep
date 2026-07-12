# Wisdom Keep — Rooted 🌱

The daily etymology game. Guess the hidden word from clues about its origin; earn Lore; build your Knowledge Kingdom.

**Live site:** https://bennyj121.github.io/wisdom-keep/

## Architecture

- **Frontend:** static site (this repo), hosted free on GitHub Pages via the workflow in `.github/workflows/deploy.yml`.
- **Backend:** Supabase project `wisdom-keep` — Postgres (puzzle bank, profiles, plays, kingdom buildings) + three edge functions:
  - `game` — serves daily clues, validates guesses server-side (answers never reach the client), awards Lore and streaks. Recycles the puzzle bank automatically if it ever runs dry, so the game never goes dark.
  - `stripe-checkout` — creates Kingdom Pass subscription checkout sessions ($4/mo, $30/yr).
  - `stripe-webhook` — keeps premium status in sync with Stripe.
- **Payments:** Stripe subscriptions. See `STRIPE-SETUP.md` in the project folder for the one-time key setup.

## How the daily puzzle works

Each row in the `puzzles` table has a `puzzle_date`. The bank is pre-seeded with 112 puzzles (through 2026-10-31). No cron job needed — the date itself selects the puzzle. Topping up the bank is the only recurring task (~1–2 hrs/month, see RUNBOOK.md).

The puzzle content (with answers) is deliberately **not** in this public repo.
