# One Stop Marketing — Allied Elite Financial Client Portal

A login-protected reporting site that shows Allied Elite Financial everything One Stop Marketing has built and manages for them.

## Tabs
- **Summary** – one-page overview for the client: websites built (active/inactive), social accounts managed, posts deployed, total traffic, leads, sales manager pages, plus trend charts. Has a Print / PDF button.
- **Agent Websites** – every agent website with active/inactive status, total count, filter and search.
- **Social Media** – every agent's managed social accounts and posts deployed per agent per month.
- **Analytics** – collective traffic across all sites plus a per-agent drill-down (visitors, page views, leads, posts, trend chart).
- **Sales Manager Pages** – every sales manager page, agents under management, and traffic.
- **Manage Data** (admin only) – add/edit/delete agents and sales managers, monthly quick entry for all numbers at once, backup/import, change passwords.

Use the **Month** selector in the header to switch which month the numbers reflect.

## Logins
| Role | Default username | Can |
|---|---|---|
| Admin (One Stop Marketing) | `onestop` | view + edit everything |
| Client (Allied Elite Financial) | `alliedelite` | view only |

On first start, passwords are taken from `ADMIN_PASSWORD` / `CLIENT_PASSWORD` env vars, or randomly generated and printed once to the console. Passwords are stored hashed in `data/users.json`. Change them anytime under **Manage Data → Logins**.

## Run it
```bash
npm install
ADMIN_PASSWORD='choose-one' CLIENT_PASSWORD='choose-another' npm start
```
Then open http://localhost:3000.

## Logo & colors
Put the One Stop Marketing logo at `public/assets/logo.png`. Until it exists, a text wordmark is shown.
Brand colors are the CSS variables at the top of `public/styles.css` (`--brand`, `--accent`).

## Data
- Live data is saved to `data/db.json` (not committed). On first run it is seeded from `data/db.sample.json`, which contains **placeholder sample agents** — replace them via Manage Data, or use **Clear all data** to start empty.
- Use **Download backup** regularly.

## Deploying
Any Node 18+ host works (Render, Railway, a VPS, etc.). Recommended env vars in production:
- `SESSION_SECRET` – long random string
- `COOKIE_SECURE=true` and `TRUST_PROXY=1` when served over HTTPS behind a proxy
- `DATA_DIR` – point to a persistent disk so data survives redeploys
