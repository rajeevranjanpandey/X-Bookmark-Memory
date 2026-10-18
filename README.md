# X-Bookmark-Memory

Your X bookmarks, automatically archived and organized. Every bookmark you save
on X lands here once a day — categorized, searchable, and browsable as a
website.

🌐 **Browse it:** https://rajeevranjanpandey.github.io/X-Bookmark-Memory/

## What's inside

| File | Purpose |
|---|---|
| `bookmarks.md` | Human-readable archive, grouped by category |
| `data/bookmarks.json` | Full machine-readable records (source of truth) |
| `data/watermark.txt` | Last synced tweet ID (sync resume point) |
| `config/categories.yaml` | Category names + keyword lists (edit to make it yours) |
| `docs/` | The browsable website (GitHub Pages) |

## How it works

A scheduled job runs daily:

1. Pulls new bookmarks from the X API
2. Extracts title, link, description, author, date
3. Categorizes each (keyword rules → LLM fallback)
4. Commits to this repo — the website updates automatically

> ⚠️ **X API tier matters:** the bookmarks endpoint is **not available on the
> Free tier**. On Free tier there is no way to fetch your bookmarks at all —
> so there is nothing to archive, categorize, or **group**. Grouping only
> works with **Basic tier or higher**.

## Downloading your bookmarks with xarchive (free, no API key)

The X API bookmarks endpoint needs a paid tier, and X's own data download
doesn't include bookmarks at all. The free path that works today is
**[xarchive](https://github.com/sytelus/xarchive)** — a Chrome extension by
[sytelus](https://github.com/sytelus) that exports your full bookmark
collection through X's internal API using your own logged-in session. No API
key, no server — everything stays in your browser.

> **Credit:** bookmark export powered by
> [sytelus/xarchive](https://github.com/sytelus/xarchive) (MIT License).

### Steps

1. **Clone it**

   ```bash
   git clone https://github.com/sytelus/xarchive.git
   ```

   ![Cloning the xarchive repo](images/step1-clone.png)

2. **Load it in Chrome** — open `chrome://extensions/`, enable **Developer
   mode** (top right), click **Load unpacked**, and select the `xarchive`
   folder.

   ![xarchive loaded in Chrome extensions](images/step2-loaded.png)

3. **Visit x.com** in Chrome so the extension picks up your login session.

4. **Run the export** — click the xarchive icon and choose **Full refresh**.
   Keep the tab open while it pages through your bookmarks.

   ![xarchive exporting bookmarks](images/step3-export.png)

5. **Download the archive** — when it finishes, click **Download combined
   archive**. You get a JSON file with every bookmark: full text, author,
   hashtags, engagement metrics.

6. **Import it here** — run:

   ```bash
   python3 scripts/import_xarchive_json.py /path/to/xarchive_*_combined.json
   ```

   This converts the export into `data/bookmarks.json`, auto-categorizes via
   `config/categories.yaml`, mirrors it to `docs/data/bookmarks.json` for the
   website, and regenerates `bookmarks.md`. Re-running it later preserves any
   manual re-tags or hidden flags set on the site.

> **Note:** on very large collections X may stop returning pages partway
> ("pagination guard"). Just run **Full refresh** again later — the extension
> keeps a cumulative archive and merges new pages without duplicates.

## Replicate it

1. X API Basic tier or higher (bookmarks endpoint isn't on Free — see note above)
2. Fork this repo, add your X credentials to your scheduler's secret store
3. Point the daily job at your account — full steps in the Replication guide below

## Categories

Defined in [`config/categories.yaml`](config/categories.yaml). Edit the file
and re-run the renderer to re-slice the whole archive.

---

## Design specification

> How bookmarked posts on X automatically land in a categorized GitHub
> repository, and how anyone can replicate the setup.

---

## 1. Problem

Bookmarks on X are a black hole. You save things to read later, but:

- X's bookmark UI has no search, no folders, no tags, no export.
- Old bookmarks rot — you forget why you saved them.
- If your account is ever locked or lost, the bookmarks are gone.

**Goal:** every bookmarked post is automatically copied into a GitHub repo,
organized by category, with title, link, description and metadata — once a day,
with zero manual effort. GitHub gives us free version history, search, and a
rendered reading page.

**Non-goals:** real-time sync (X offers no webhook for bookmarks — polling is
the only option); liking/reposting from the repo; handling DMs or private
content.

---

## 2. Constraints (read this before replicating)

| Constraint | Impact |
|---|---|
| X API bookmarks endpoint (`GET /2/users/:id/bookmarks`) needs **Basic tier or higher** (~$100/mo). **Free tier cannot read bookmarks at all — so there is nothing to archive, categorize, or group.** | No free-tier path via official API. Grouping requires Basic+. |
| No webhook/event for "new bookmark". | Sync must **poll**. We poll once every 24h (user-approved cadence). |
| Bookmarks endpoint returns tweet IDs in reverse-chronological order, paginated (max 100/page). | We page through and stop at the watermark (last seen ID). |
| Tweet text alone is often cryptic (memes, quote-posts). | We store the tweet URL so the original is one click away; description = tweet text + expanded URLs. |
| Rate limits (Basic: 10k tweets/month read). | Daily poll of ≤100 bookmarks is far under the cap. |
| Credentials must never live in chat, logs, or the repo. | X Bearer token / OAuth tokens go through the platform's secure vault; the sync job reads them at runtime only. |

**Why not browser scraping instead?** It works without a paid API tier, but it
breaks whenever X changes its markup, needs an always-logged-in session, and
can't run unattended reliably. The API path is boring and stable — that's the
point.

---

## 3. Architecture overview

```
┌─────────┐      daily cron       ┌──────────────────┐
│  X API  │ ◄──────────────────── │   Sync worker    │
│ (source │   GET /2/users/:id/   │  (scheduled job) │
│ of truth)│   bookmarks         └────────┬─────────┘
└─────────┘                                │
                                           ▼
                                  ┌──────────────────┐
                                  │  Normalize +     │
                                  │  categorize      │
                                  └────────┬─────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
             bookmarks.md            data/bookmarks.json     watermark
          (human-readable,        (machine-readable,      (last synced
           categorized)            full records)            tweet ID)
                    └──────────────────────┼──────────────────────┘
                                           ▼
                                  ┌──────────────────┐
                                  │  git commit+push │
                                  │  to GitHub repo  │
                                  └──────────────────┘
```

**Components:**

1. **Sync worker** — a scheduled agent job (cron, `0 9 * * *`-style daily).
   Owns the whole pipeline: fetch → normalize → categorize → dedupe →
   render → commit.
2. **X API client** — thin wrapper over two endpoints:
   - `GET /2/users/:id/bookmarks` (list bookmarked tweet IDs)
   - `GET /2/tweets?ids=...` with expansions (hydrate author, text,
     created_at, entities.urls, public_metrics, attachments)
3. **Categorizer** — rule-based keyword matcher first, LLM fallback for
   ambiguous posts. Deterministic and free for the common case.
4. **Renderer** — writes `bookmarks.md` (grouped by category, newest first)
   and `data/bookmarks.json` (append-only record log).
5. **GitHub repo** — the sink. Version history doubles as the audit log of
   *when* each bookmark was captured.

**Why GitHub and not Notion/Obsidian/etc.?** Zero cost, git history shows
exactly when each bookmark entered the system, Markdown renders natively, and
`bookmarks.json` lets anyone build on top (search UI, newsletter, etc.).

**Why daily and not hourly?** Bookmarks are a slow-moving "read later" list,
not an alert feed. Daily keeps API usage trivial and each commit a meaningful
batch. (The design supports any cadence — change the cron schedule, nothing
else moves.)

---

## 4. Data schema

One record per bookmarked tweet, stored in `data/bookmarks.json`:

```json
{
  "tweet_id": "1234567890",
  "url": "https://x.com/somehandle/status/1234567890",
  "author_name": "Jane Doe",
  "author_handle": "janedoe",
  "text": "Full tweet text…",
  "tweet_created_at": "2026-10-15T08:12:00Z",
  "synced_at": "2026-10-17T09:00:00Z",
  "category": "AI/ML",
  "expanded_urls": ["https://example.com/article"],
  "likes": 1200,
  "reposts": 300,
  "has_media": true
}
```

Rendered in `bookmarks.md` as:

```markdown
## AI/ML

### Jane Doe (@janedoe) — 2026-10-15
Full tweet text…
🔗 https://x.com/janedoe/status/1234567890 · 📎 https://example.com/article
```

**Why both formats?** Markdown is for humans browsing the repo. JSON is for
machines — and for *you* later, when you want to query ("show me all
bookmarks about RAG from 2026") without re-parsing Markdown.

---

## 5. Sync flow (step by step)

1. **Load watermark** — read `data/watermark.txt` (the highest tweet ID synced
   so far). First run: no watermark → fetch the most recent page only (don't
   backfill years of history unless asked).
2. **Fetch bookmarks** — page `GET /2/users/:id/bookmarks` until a page
   contains only IDs ≤ watermark, or pages are exhausted.
3. **Hydrate** — batch-hydrate new IDs via `GET /2/tweets` (≤100 IDs/call)
   with `expansions=author_id`, `tweet.fields=created_at,entities,public_metrics,attachments`,
   `user.fields=name,username`.
4. **Normalize** — build one record per tweet per the schema above. Deleted or
   protected tweets come back empty from hydration → logged and skipped (the
   bookmark still exists on X; we just can't read it).
5. **Categorize** — keyword rules first (see §6); ambiguous → single LLM call
   with the tweet text; unknown → `Uncategorized`.
6. **Dedupe** — skip any tweet ID already in `bookmarks.json` (idempotent:
   re-running a day changes nothing).
7. **Render** — regenerate `bookmarks.md` from JSON (single source of truth;
   never hand-edit the Markdown), append new records to JSON.
8. **Commit & push** — one commit per sync: `sync: +N bookmarks (YYYY-MM-DD)`.
9. **Update watermark** — write the new max tweet ID. Only after a successful
   push (so a failed push retries the same batch next run instead of losing it).

---

## 6. Categorization strategy

**Tier 1 — keyword rules (no cost, deterministic).** Each category owns a
keyword list; first match wins. Example seeds:

| Category | Keywords |
|---|---|
| AI/ML | llm, transformer, rag, agent, diffusion, fine-tune, pytorch |
| Data | spark, dbt, airflow, warehouse, lakehouse, etl, dashboard |
| Career | hiring, interview, resume, job, promotion, salary |
| Startups | yc, seed, series a, founder, mvp, pitch |
| Finance | markets, stocks, fed, inflation, crypto, bitcoin |
| Tech | github, api, kubernetes, python, rust, open source |
| Productivity | notion, workflow, automation, gtd, shortcuts |
| Fun | meme, lol, 😂 (has_media + short text heuristic) |

**Tier 2 — LLM fallback.** If no rule matches, one cheap classification call:
*"Categorize this tweet into one of [list] or Uncategorized. Reply with the
category only."*

**Why rules first?** ~80% of bookmarks match obvious keywords; rules are free,
instant, and reproducible. The LLM only handles the long tail. Anyone
replicating can extend the keyword lists without touching code.

**Recategorization:** categories live in `config/categories.yaml`. Editing it
and re-running the renderer re-slices the whole archive — no data loss, since
JSON keeps the raw records.

---

## 7. Dedupe & idempotency

- Tweet ID is the primary key. A bookmark synced twice (retry, overlap) is
  written once.
- Un-bookmarking on X does **not** delete from the repo. The repo is an
  archive, not a mirror — this is deliberate (you bookmarked it for a reason).
- Re-running the sync for the same day produces zero new commits
  (watermark stops the fetch; dedupe stops the write).

---

## 8. Failure modes

| Failure | Behavior |
|---|---|
| X API 429 (rate limit) | Back off; watermark untouched → next run retries the same window. |
| X API 401 (token expired) | Job fails loudly; user re-auths via secure flow. No partial state. |
| Tweet deleted/protected | Skipped with a log line; watermark still advances past it. |
| GitHub push rejected | Watermark not updated → next run replays the batch. |
| LLM categorizer down | Falls back to `Uncategorized`; a later re-run can re-categorize. |
| Cron missed a day | Next run just picks up a bigger batch — watermark makes gaps harmless. |

**Design principle:** the watermark only advances after a fully successful
push. Every failure mode degrades to "try the same work again tomorrow."

---

## 9. Security

- X API credentials: stored in the platform's secure vault, injected as env
  vars at job runtime. Never in chat, logs, files, or the repo.
- GitHub access: via the connected GitHub App (scoped to this repo only), not
  a personal access token in a file.
- The repo itself is public-or-private at the owner's choice. Default
  recommendation: **private** — bookmarks reveal interests.
- Tweet text is quoted under fair-use-style excerpting; the canonical link
  always points back to X.

---

## 10. Repository layout

```
x-bookmarks/
├── README.md               # this file: overview + full design spec
├── bookmarks.md            # rendered, categorized reading page
├── data/
│   ├── bookmarks.json      # append-only full records (source of truth)
│   └── watermark.txt       # last synced tweet ID
└── config/
    └── categories.yaml     # category names + keyword lists
```

**Why this layout?** `bookmarks.md` is the front door (GitHub renders it on
the repo homepage). `data/` is the durable store. `config/` is the only thing
a replicator edits to make it theirs.

---

## 11. Replication guide (for others)

1. **X API access** — apply for a developer account, subscribe to **Basic**
   tier or higher (bookmarks endpoint is not on Free). Create an app with
   OAuth 2.0, request the `bookmark.read` and `tweet.read` scopes, authorize
   as yourself.
2. **GitHub repo** — create `x-bookmarks` (private recommended). Copy this
   repo's layout: `README.md`, `DESIGN.md`, `data/`, `config/`.
3. **Credentials** — store the X OAuth tokens in your scheduler's secret
   store (never in the repo).
4. **Scheduler** — any cron-like runner (GitHub Actions `schedule`, a VPS
   cron, or an agent platform's scheduled jobs). Daily is plenty:
   `0 9 * * *`.
5. **Sync script** — implement §5 in ~150 lines of Python: two X endpoints,
   the schema in §4, rules from §6, render, commit, push.
6. **Customize** — edit `config/categories.yaml` to your interests; re-run
   the renderer to re-slice history.

Total build time for a competent replicator: an afternoon.

---

## 12. Future improvements (not v1)

- **Thread unrolling** — expand bookmarked thread roots into full text.
- **Link unfurling** — fetch `<title>`/description for expanded URLs at sync
  time (richer descriptions).
- **Semantic search** — embed `bookmarks.json` and serve a tiny search UI.
- **Weekly digest** — email/WhatsApp summary of the week's bookmarks by
  category.
- **De-duplication across reposts** — collapse the same viral post bookmarked
  twice via different quote-posts.

---

## 13. Decision log

| Decision | Why |
|---|---|
| Poll daily, not realtime | X has no bookmark webhooks; bookmarks are slow-moving anyway. |
| Official API over scraping | Stable contract, unattended-safe; scraping breaks on markup changes. |
| Markdown + JSON dual output | Humans read Markdown; machines (and future-you) query JSON. |
| Watermark = max tweet ID | Tweet IDs are roughly time-ordered; simple, robust resume point. |
| Archive, not mirror (no deletes) | Un-bookmarking shouldn't erase history you chose to keep. |
| Rules-before-LLM categorization | Free, deterministic, and replicable for the common case. |
| Private repo default | Bookmarks are a window into your interests — keep it yours. |
| 2026-10-17 | Design spec merged into README.md | One front-door document — visitors read the full spec on the repo landing page instead of hunting for a second file. |
