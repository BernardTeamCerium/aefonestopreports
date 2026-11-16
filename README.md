# One Stop Marketing Solutions — Allied Elite Financial Client Portal

A login-protected reporting site that shows Allied Elite Financial everything One Stop Marketing Solutions has built and manages for them. Hosted on **Netlify**.

## Tabs
- **Summary** – one-page overview for the client: websites built (active/inactive), social accounts managed, posts deployed, total traffic, leads, sales manager pages, plus trend charts. Has a Print / PDF button.
- **Agent Websites** – every agent website with active/inactive status, total count, filter and search.
- **Social Media** – every agent's managed social accounts and posts deployed per agent per month.
- **Analytics** – collective traffic across all sites plus a per-agent drill-down.
- **Sales Manager Pages** – every sales manager page, agents under management, and traffic.
- **Manage Data** (admin only) – add/edit/delete agents and sales managers, monthly quick entry, backup/import, change passwords.

Use the **Month** selector in the header to switch which month the numbers reflect.

## Logins
| Role | Username | Can |
|---|---|---|
| Admin (One Stop Marketing) | `onestop` | view + edit everything |
| Client (Allied Elite Financial) | `alliedelite` | view only |

## Netlify setup (one time)
1. In Netlify: **Add new site → Import from Git →** pick `aefonestopreports`. Build settings are read from `netlify.toml` automatically (build `npm run build`, publish `public`).
2. **Site configuration → Environment variables**, add:
   - `SESSION_SECRET` – any long random string (32+ characters)
   - `ADMIN_PASSWORD` – first password for `onestop`
   - `CLIENT_PASSWORD` – first password for `alliedelite`
3. **Deploys → Trigger deploy** (environment variables only apply to new deploys).

The passwords are used once to create the logins on first sign-in; after that, change them under **Manage Data → Logins** (changing a password signs that user out everywhere).
All portal data and logins are stored in **Netlify Blobs** on the site — no database to set up.

## How to update

**Names and numbers (no code, no redeploy):** sign in as `onestop` → **Manage Data**.
- *Add agent / Add sales manager* – new entries; *Edit* to change websites, status, socials, or monthly numbers.
- *Monthly quick entry* – pick a month and type posts, visitors, page views and leads for everyone at once.
- Click any **Active/Inactive** badge to flip a status.
- *Download backup (JSON)* regularly; *Import JSON* restores one.
Changes are live for the client immediately.

**Design or features (code):** commit to the GitHub branch Netlify deploys from; Netlify rebuilds automatically in about a minute. Data is not affected by redeploys.

## Logos & colors
- `public/assets/logo.png` – One Stop Marketing Solutions logo; `icon.png` – browser tab icon.
- `public/assets/aef-logo.svg` / `aef-mark.svg` – Allied Elite Financial logo (vector recreation; overwrite with the official SVGs if available).
- Colors are CSS variables at the top of `public/styles.css`.

## Run locally
```bash
npm install
ADMIN_PASSWORD='choose-one' CLIENT_PASSWORD='choose-another' npm run dev
```
Open http://localhost:3000. Local data is stored in `data/local/` (not committed). The first load is seeded from `data/db.sample.json` (placeholder sample agents — use **Clear all data** in Manage Data to start fresh).

## Code layout
- `public/` – the site (HTML/CSS/JS)
- `src/api.mjs` – login, sessions and data API (shared by Netlify and local dev)
- `netlify/functions/api.mjs` – Netlify Function wrapper using Netlify Blobs
- `scripts/dev.mjs` – local preview server
