# Support Analysis Dashboard — Static Site

Replaces the old Streamlit app with a fast, free, static dashboard. The site is pure
HTML/CSS/JS + ECharts and reads pre-built JSON files from `web/data/`. Data is
refreshed every hour by a GitHub Actions workflow that downloads the public Google
Sheets, runs `pipeline/build_data.py`, and publishes a fresh static site to
GitHub Pages — no API keys, no database, no hosting cost.

## Folder layout

```
.github/workflows/refresh.yml   Hourly data refresh + deploy (GitHub Actions)
pipeline/build_data.py          Python builder: Sheets -> web/data/*.json (+ .gz)
web/                            The deployable site (this folder is the site root)
  index.html                    Login screen + dashboard shell
  app.js                        All dashboard logic (ECharts, filters, tabs, slideshow)
  styles.css                    Dsquares identity (#0055A4 / #002147 / #00AEEF, Sora/DM Sans)
  access.json                   Login access keys (edit this file to add/remove users)
  assets/                       Client logos
  data/                         Auto-generated JSON + gzip files (do NOT hand-edit)
streamlit_app.py                The old Streamlit app, kept as the logic reference
```

## One-time setup (GitHub Pages)

1. Create a new **empty** GitHub repository (private or public).
2. Open **Settings → Pages** and set **Source = "GitHub Actions"** (not "Deploy from a branch").
3. Upload the whole project to the repository:
   - Use the GitHub web UI **Add file → Upload files**, or
   - `git init && git add . && git commit -m "initial" && git branch -M main && git remote add origin <url> && git push -u origin main`
4. Open the **Actions** tab → **Refresh Data** workflow → **Run workflow** once. This
   first run fetches the Sheets, builds `web/data/`, and publishes the site.
5. After it finishes, your dashboard is live at `https://<user>.github.io/<repo>/`.

> The site root is `web/` (index.html lives there). Data paths are relative, so the
> same folder works unchanged on Cloudflare Pages, Netlify, Vercel, or any static host.

## Automatic hourly refresh

- The **Refresh Data** workflow runs at the top of every hour (`0 * * * *`).
- It also has a **Run workflow** button in the Actions tab for an on-demand refresh.
- If a sheet fetch fails, the build aborts and the last good deployment stays live.

## Managing access keys

Edit `web/access.json` and push. Keys are checked client-side on login; the site
reloads `access.json` on every page load, so no rebuild is needed.

## Preview locally

```bash
python -m http.server 8123 --directory web
```

Then open `http://localhost:8123`.

## Rebuild data manually (optional)

Requires Python 3.10+ with pandas:

```bash
pip install pandas
python pipeline/build_data.py
```

This rewrites `web/data/*.json` (+ `.gz`) from the public Google Sheets CSV exports.
