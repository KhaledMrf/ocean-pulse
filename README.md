# Ocean Pulse 🌊

The member app for **Ocean Fitness** — see how busy the gym is right now, and the
typical busy hours for every day of the week.

**Open it:** https://khaledmrf.github.io/ocean-pulse/

It's an installable web app (PWA): open the link on your phone and choose
**Add to Home Screen** — it works like a regular app, no app store needed.

## What's in this repo

Just the app itself — plain HTML/CSS/JS in [`docs/`](docs/), served by GitHub Pages.
No frameworks, no build step, no member data, no secrets.

- `docs/config.js` — the one deployment setting (the API URL).
- The API it talks to is a small read-only service maintained separately.

## Roadmap

- **M1 — live busyness + popular times** (public, no login) ← current
- **M2** — smarter popular-times curve that improves every week
- **M3** — member login: your plan, days remaining, renewal history
- **M4** — your activity: visits, weekly streaks, milestones
- **M5** — offline polish, English/Arabic
- **M6** — reminders & class booking
