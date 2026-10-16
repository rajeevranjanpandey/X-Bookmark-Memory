# X-Bookmark-Memory — Design Document

> An automated archive of your X (Twitter) bookmarks, synced on a schedule into a
> searchable, categorized Git repository. Bookmarks rot — this makes them last.

---

## 1. Problem & non-goals

### The problem: bookmarks rot

X bookmarks are a write-only graveyard:

- **No organization.** Bookmarks are a single flat chronological list. There are
  no folders, tags, or categories.
- **Weak search.** X's own bookmark search is unreliable, and it only searches
  what X's index happens to return.
- **No export.** There is no official "download my bookmarks" button. Your
  saved knowledge lives entirely inside X's walls.
- **Single point of failure.** If your account is locked, suspended, or you
  simply leave the platform, years of saved posts vanish with it. Even individual
  tweets get deleted by their authors — the bookmark entry then points at
  nothing.
- **No memory.** A bookmark captures no context: *why* you saved it, what it
  connects to, what you thought at the time.

### What we're fixing

A durable, personal, searchable archive of bookmarked posts:

- Every bookmark is captured as a structured record (text, author, links, media
  references, metrics at capture time) plus a human-readable Markdown rendering.
- Records are categorized automatically so the archive stays navigable as it
  grows.
- Storage is a Git repository: versioned, portable, diffable, and trivially
  backed up or moved. No database to babysit.
- Sync runs on a schedule without human intervention.

### Non-goals (what we're deliberately NOT building)

- **Not a Twitter client.** No timeline, no posting, no engagement. Read-only
  with respect to X, except for reading your own bookmarks.
- **Not a read-later app.** No annotation UI, no highlighting workflow, no mobile
  app. The repo *is* the interface.
- **Not real-time.** Sync is polling-based on a schedule (hourly/daily). If you
  need a bookmark archived within seconds, this isn't it.
- **Not social.** The archive is personal. No sharing, no feeds, no followers.
- **Not a scraper that evades X's terms.** All reads go through the official X
  API on a paid tier. If the API can't give it, we don't take it.
- **Not an archive of other people's bookmarks.** Only the authenticated user's
  own bookmarks.

---

## 2. Constraints

### X API Basic tier is required

- The bookmarks endpoints (`GET /2/users/:id/bookmarks`) are **not available on
  the Free tier**. A Basic-tier (or higher) developer app is a hard requirement.
- Basic tier carries a monthly post cap and per-15-minute rate limits. Exact
  numbers change — verify against the current X API docs at implementation time
  and record them in `config/limits.yaml`. The design assumes the cap is finite
  and small enough that the sync must be economical: fetch only what's new,
  page minimally, never re-fetch the full list.
- Consequence: the system must treat every API call as budgeted (see §8,
  failure modes).

### No webhooks — polling only

- X offers no webhook or streaming event for "bookmark added/removed." The only
  way to learn about new bookmarks is to poll the bookmarks endpoint on a
  schedule.
- Consequence: sync latency equals the poll interval. A new bookmark appears in
  the archive at the next scheduled run, not instantly. The watermark mechanism
  (§5) makes polling cheap and idempotent.

### Rate limits

- X enforces per-endpoint rate limits on 15-minute windows. Hitting a limit
  returns HTTP 429 with a `x-rate-limit-reset` header.
- The sync must: read the reset header, back off until the window resets, and
  resume from the saved watermark rather than restarting (see §8).
- The scheduler should space runs so a full sync comfortably fits inside one
  rate-limit window under normal bookmark volume.

### Credential handling

- Access requires a user-context credential (OAuth 2.0 access token for the
  bookmark owner's account), because bookmarks are private to the user.
- The credential **never** lives in the repository, in committed config, or in
  logs. It is stored in the platform's secret store (GitHub Actions secrets for
  the scheduled run, or a local vault for manual runs) and injected as an
  environment variable at runtime.
- Token refresh (OAuth 2.0 refresh flow) must be supported: an expired token is
  an expected event, not an exceptional one (§8).

---

## 3. Architecture

```
                ┌─────────────┐
                │  Scheduler  │  cron / GitHub Actions — triggers a run
                └──────┬──────┘
                       │ invokes
                ┌──────▼──────┐      ┌──────────────┐
                │   Worker    │─────▶│  State store │  watermark.json
                │  (sync.py)  │◀─────│  (in repo)   │
                └──────┬──────┘      └──────────────┘
           ┌───────────┼───────────────┐
           │           │               │
    ┌──────▼────┐ ┌────▼──────┐ ┌──────▼──────┐
    │ X client  │ │Categorizer│ │  Renderer   │
    │(x_client) │ │(rules +   │ │ (JSON → MD) │
    │           │ │ LLM)      │ │             │
    └───────────┘ └───────────┘ └─────────────┘
           │                           │
           │  records                  │  markdown
           └───────────┬───────────────┘
                       ▼
                ┌──────────────┐
                │ GitHub (sink)│  commit + push to this repo
                └──────────────┘
```

### Why each piece exists

| Component | Why it exists |
|---|---|
| **Scheduler** | Polling needs a trigger. Cron (or GitHub Actions `schedule`) is the simplest reliable one — no server to run, no process to supervise. |
| **Worker (`sync.py`)** | One orchestrator that runs the 9-step sync flow (§5) in order. Keeps sequencing, error handling, and the watermark rule in a single auditable place instead of scattered across scripts. |
| **X client (`x_client.py`)** | Isolates all X API knowledge (auth, pagination, rate-limit backoff, field selection) behind one interface. If X changes its API, only this file changes. |
| **Categorizer** | A flat chronological dump is barely better than X's own list. Categorization is what turns the archive into something navigable. Split into deterministic keyword rules (free, instant) with an LLM fallback for the ambiguous remainder (§6). |
| **Renderer** | Machines read JSON; humans read Markdown. The renderer produces both from one record so the two can never disagree (§4). |
| **GitHub as sink** | Git is the database. Commits are the audit log, diffs show exactly what each sync added, and `git log`/`git blame` answer "when did I save this?" for free. No database server, no backups to configure, no vendor lock-in beyond a git remote. |
| **State store (`state/watermark.json`, committed)** | The watermark (newest archived bookmark) lives in the repo itself so state survives across machines and scheduled runs with zero external infrastructure. It advances only after a successful push (§5, step 9). |

---

## 4. Data schema

### JSON record (source of truth)

One JSON object per bookmarked tweet, appended to `data/bookmarks.jsonl`
(one record per line — append-friendly, streamable, diffable):

```json
{
  "record_id": "bkm_01J9Z8XQ2M5N7P3R4T6V8W0Y2A",
  "tweet_id": "1846237415923187965",
  "bookmarked_at": "2026-10-16T14:02:11Z",
  "captured_at": "2026-10-16T18:00:04Z",
  "author": {
    "username": "somehandle",
    "display_name": "Some Person",
    "user_id": "123456789"
  },
  "text": "Full tweet text, untruncated…",
  "urls": ["https://example.com/article"],
  "media": [
    { "type": "photo", "url": "https://pbs.twimg.com/…" }
  ],
  "metrics_at_capture": { "likes": 412, "reposts": 87, "replies": 23 },
  "category": "ai-research",
  "tags": ["llm", "eval"],
  "content_hash": "sha256:9f2c…",
  "status": "active",
  "note": ""
}
```

Field notes:

- `record_id`: ULID — sortable by creation time, unique without coordination.
- `tweet_id`: the natural key for dedupe (§7). Never changes.
- `bookmarked_at` vs `captured_at`: when *you* saved it vs when the *archive*
  captured it. The gap is the poll latency; both matter.
- `metrics_at_capture`: a snapshot, not a live count. The archive records what
  was true when captured — it does not track later virality.
- `media[].url`: we store *references*, not binaries. Downloading media
  multiplies storage and API cost; references are enough for an archive, and
  full media archival is a listed future improvement (§12).
- `content_hash`: SHA-256 of the normalized text. Detects silent edits.
- `status`: `active` | `deleted` | `unavailable`. Tombstones, never hard
  deletes (§7, §8).
- `note`: free-text field for the human to annotate later via a normal git
  commit. The system never writes to it.

### How it renders in Markdown

The renderer produces one file per bookmark at
`archive/YYYY/MM/<tweet_id>.md`:

```markdown
# Bookmark — 2026-10-16

**Author:** [@somehandle](https://x.com/somehandle) (Some Person)
**Posted:** 2026-10-14 · **Bookmarked:** 2026-10-16 14:02 UTC
**Category:** ai-research · **Tags:** llm, eval
**Original:** https://x.com/somehandle/status/1846237415923187965

---

Full tweet text, untruncated…

---

*Captured 2026-10-16 18:00 UTC · ♥ 412 · 🔁 87 · 💬 23*
```

Plus a per-category index regenerated each run
(`archive/_index/ai-research.md`) listing that category's bookmarks newest-first
with one-line excerpts — this is the actual browsing surface.

Markdown is generated *from* the JSON records, never hand-edited. If the two
ever disagree, JSON wins and Markdown is regenerated.

---

## 5. Sync flow

Nine steps, executed in order by the worker. The watermark rule (step 9) is the
load-bearing invariant of the whole system.

1. **Load watermark.** Read `state/watermark.json` → `{ "newest_tweet_id",
   "newest_bookmarked_at", "last_run_at" }`. This is the high-water mark: everything
   at or below it is already archived.
2. **Authenticate.** Build the X client from the vault-injected credential.
   Fail fast here on 401 — don't burn rate limit on a dead token (§8).
3. **Fetch bookmarks.** Page through `GET /2/users/:id/bookmarks` (requesting
   `tweet.fields=created_at,public_metrics,entities,attachments`,
   `expansions=author_id`, `user.fields=username,name`). Stop paginating once a
   page's oldest item is at or below the watermark.
4. **Filter to new items.** Keep only items with `bookmarked_at` newer than the
   watermark (or equal timestamp but unseen `tweet_id` — bookmark timestamps
   have finite resolution).
5. **Dedupe.** Drop any `tweet_id` already present in `data/bookmarks.jsonl`
   (§7). After this step, every remaining item is genuinely new.
6. **Categorize.** Run each new item through the categorizer (§6): keyword
   rules first, LLM fallback for the rest. Attach `category` + `tags`.
7. **Render.** Append JSON records to `data/bookmarks.jsonl`; write one
   Markdown file per bookmark; regenerate the category indexes.
8. **Commit & push.** Single commit (`sync: +N bookmarks (<timestamp>)`),
   push to `main`. On push conflict: pull --rebase and retry once (§8).
9. **Advance the watermark — only after the push succeeds.** Set
   `newest_tweet_id` / `newest_bookmarked_at` to the newest archived item,
   commit the watermark file, push.

### The watermark-advances-only-after-push rule

This ordering is deliberate and non-negotiable:

- If the watermark advanced *before* the push and the push then failed, those
  bookmarks would be marked "done" without ever reaching the archive — **silent
  data loss**.
- If the push succeeds but the watermark commit fails, the next run re-fetches
  the same items — but dedupe (§7) drops them as already-recorded, so the worst
  case is a duplicate-free no-op re-render. **Safe retries beat lost data.**
- The watermark is therefore always a *conservative* claim: "everything up to
  here is durably archived." It may lag reality; it may never lead it.

---

## 6. Categorization

### Keyword rules first (free, deterministic)

`config/categories.yaml` defines categories as ordered keyword sets:

```yaml
categories:
  ai-research:
    keywords: [llm, transformer, benchmark, eval, arxiv, fine-tune, rag]
    weight: 1.0
  markets:
    keywords: [fed, inflation, earnings, "s&p", treasury, rate cut]
    weight: 1.0
  # …more categories…

fallback: uncategorized
recategorize_on_config_change: true
```

- Matching is case-insensitive against tweet text + author bio + expanded URLs.
- First category whose keyword threshold is met wins; ties break by config
  order (deterministic — same input, same output, every run).
- Costs nothing, runs instantly, needs no network. The majority of bookmarks
  should be caught here.

### LLM fallback

- Items still `uncategorized` after keyword rules go to a small classifier call:
  prompt includes the category list with one-line descriptions; the model
  returns exactly one category name or `uncategorized`.
- Keep it cheap: short prompt, low max-tokens, batch multiple items per call
  where the provider allows.
- The LLM's answer is recorded in the record's `tags` as `llm-classified` so
  its provenance is visible. Keyword hits are never sent to the LLM.

### Recategorization via config

- Categories are a living taxonomy — you'll rename, split, and add them.
- When `config/categories.yaml` changes, the next sync re-runs categorization
  over **all** records (keyword pass; LLM pass only for items whose category
  would change *away* from a human-confirmed one — see below).
- A record's `category` may carry a `locked: true` flag (set by committing a
  manual edit). Locked categories survive recategorization. This is how human
  judgment overrides automation without being overwritten next run.

---

## 7. Dedupe & idempotency

### Archive, not mirror

This system is an **archive**, not a mirror of X's live state:

- We capture a snapshot at bookmark time and keep it forever, even if the
  tweet is later deleted, the author is suspended, or the text is edited.
- We never delete a record because X no longer returns it. Absence from a poll
  response is not evidence of un-bookmarking (pagination, API quirks) — so we
  don't infer deletions from it. Explicit tombstoning (§8) is the only path to
  `status: deleted`.
- Consequence: the archive can only grow. Storage planning is trivial
  (text compresses well; JSONL appends).

### Dedupe keys

- **Primary key: `tweet_id`.** Re-bookmarking the same tweet, or re-fetching it
  across runs, always collapses to one record.
- **Content hash** (`content_hash`) detects *edits*: if a re-fetched tweet's
  hash differs from the stored record, append a new revision entry linked by
  `tweet_id` with `revision: 2` rather than overwriting. History is preserved;
  the Markdown renders the latest revision with an "edited" marker.

### Safe retries

Every step is designed so re-running it is harmless:

- Fetch: read-only.
- Filter/dedupe: pure functions of (API response, existing records).
- Render: deterministic output from records; overwriting a Markdown file with
  identical content is a no-op diff.
- Push: git commits are content-addressed; pushing the same tree twice is safe.
- Watermark: advances only on success (§5.9), so a failed run simply redoes
  work that dedupe then absorbs.

A run can be killed at any point — including mid-push — and the next run
converges to the correct state without manual cleanup.

---

## 8. Failure modes

| Failure | Detection | Response |
|---|---|---|
| **429 rate limited** | HTTP 429 + `x-rate-limit-reset` header | Sleep until reset, then resume from the saved watermark. Never retry blindly in a tight loop — each retry burns budget. If the sync can't finish within the monthly cap, it finishes *next* run; the watermark guarantees nothing is skipped. |
| **401 unauthorized** | Auth step or any call returns 401 | Stop immediately (don't burn rate limit). Attempt OAuth refresh once if a refresh token exists. On refresh failure: fail the run loudly (non-zero exit, alert) — a human must re-authorize. The watermark is untouched, so no data is lost. |
| **Deleted / suspended tweets** | Tweet fetch returns 404, or author lookup fails | Keep the existing record; set `status: deleted` (or `unavailable` if ambiguous) with `status_changed_at`. Append a tombstone note to the Markdown file. Never remove the record — the text we captured is the archive's whole point. |
| **Push conflicts** | `git push` rejected (non-fast-forward) | `git pull --rebase`, re-render indexes (they're deterministic), retry push once. Persistent conflict (shouldn't happen single-writer) → fail loudly for human inspection. The design assumes a single writer; concurrent writers are out of scope. |
| **Partial page fetch** | Network error mid-pagination | Watermark hasn't advanced (step 9), so the next run re-fetches. Dedupe absorbs duplicates. No special handling needed — this is what the watermark rule buys. |
| **LLM classifier failure** | Timeout, malformed response, API error | Fall back to `uncategorized` and continue. Categorization must never block archiving — an uncategorized saved tweet beats a lost one. Retry classification next run. |
| **Credential expired mid-run** | 401 after initial success | Same as 401 above: stop, attempt refresh, fail loudly. Items already rendered but unpushed are safe (watermark not advanced). |

### What "fail loudly" means

The scheduled run must be *visible* when it fails: non-zero exit code, and
(where the platform supports it) a notification — GitHub Actions job failure
email, or a dead-man's-switch check that alerts if no successful run lands
within 2× the schedule interval. A silently dead archiver is worse than none,
because you believe you're backed up when you're not.

---

## 9. Security

- **Vault-stored credentials.** The X API credential (OAuth access + refresh
  tokens) lives in the platform secret store (GitHub Actions secrets /
  environment), injected at runtime. It is never written to disk in the repo,
  never committed, never logged. The worker redacts `Authorization` headers in
  all error output.
- **Least-privilege GitHub access.** The automation authenticates as a GitHub
  App (or deploy key) scoped to **this repository only**, with `contents:
  write` and nothing else. No org access, no admin rights, no workflow
  permissions beyond what's needed for the scheduled run.
- **Private repo by default.** Bookmarks are a window into what you read, care
  about, and plan — that profile is worth protecting. Default to private; go
  public only as a conscious, documented choice (see decision log, §12).
- **No secrets in config.** `config/` holds categories, limits, and schedules —
  all safe to commit. Anything resembling a token fails CI via a secret-scan
  (e.g., gitleaks) on every push.
- **Dependency hygiene.** The worker's dependencies are pinned
  (`requirements.txt` with hashes); scheduled runs install from the lockfile,
  not floating versions.

---

## 10. Repo layout

```
X-Bookmark-Memory/
├── README.md                  # what this is + pointer to DESIGN.md
├── DESIGN.md                  # this document — the full spec
├── config/
│   ├── categories.yaml        # category taxonomy + keyword rules (§6)
│   └── limits.yaml            # X API quotas/limits, verified at setup
├── data/
│   └── bookmarks.jsonl        # the archive: one JSON record per line (§4)
├── archive/
│   ├── 2026/10/<tweet_id>.md  # one Markdown file per bookmark (§4)
│   └── _index/
│       └── <category>.md      # regenerated per-category indexes
├── state/
│   └── watermark.json         # high-water mark; advances only after push (§5)
├── src/
│   ├── sync.py                # the worker: 9-step orchestration (§5)
│   ├── x_client.py            # X API isolation layer (§3)
│   ├── categorizer.py         # keyword rules + LLM fallback (§6)
│   └── renderer.py            # JSON → Markdown + indexes (§4)
├── requirements.txt           # pinned dependencies
└── .github/
    └── workflows/
        └── sync.yml           # scheduled run (cron) + secret wiring
```

### Why it's laid out this way

- **`data/` vs `archive/`:** machine-readable source of truth vs
  human-readable rendering, kept separate so tooling and browsing don't
  interfere. JSONL appends cleanly; Markdown files browse natively on GitHub.
- **`state/` in-repo:** zero external infrastructure for the watermark. The
  repo is self-contained: clone it anywhere and a run resumes correctly.
- **`config/` committed:** categories and limits are *decisions*, and decisions
  belong in version control where their history is visible.
- **`src/` flat:** four modules, one per architectural component. No package
  ceremony for a ~500-line worker.
- **`.github/workflows/`:** the scheduler lives next to the code it runs.

---

## 11. Replication guide

Rebuild this system from scratch in an afternoon (≈3–4 hours):

1. **X developer app.** Create a project/app at developer.x.com, apply for
   **Basic tier** (Free tier lacks the bookmarks endpoints). Create the repo,
   generate a user-context OAuth 2.0 token for your own account, and store the
   access + refresh tokens in your secret store. Record the current rate limits
   in `config/limits.yaml`.
2. **Clone and configure.** Clone this repo. Copy `config/categories.yaml` and
   edit the keyword sets to match your interests — this is the highest-leverage
   20 minutes of the whole setup.
3. **Local dependencies.** `pip install -r requirements.txt`. Set the
   credential env vars locally (from your vault, never committed) and run
   `python src/sync.py --once --dry-run` to verify auth, pagination, and
   rendering without pushing.
4. **First real sync.** Run `python src/sync.py --once`. Check
   `data/bookmarks.jsonl`, spot-check a few Markdown files, confirm the
   watermark advanced in `state/watermark.json`.
5. **Schedule it.** Add your secrets to the repo's Actions secrets and enable
   `.github/workflows/sync.yml` (default: hourly). The workflow is
   read-mostly and idempotent — a misconfigured first run can't corrupt
   anything (watermark rule, §5.9).
6. **Verify the loop.** After the first two scheduled runs, confirm: new
   bookmarks appear as commits, the watermark advances, and a forced re-run
   produces an empty diff (idempotency proof).

---

## 12. Future improvements & decision log

### Future improvements (not yet built)

- **Full-text search index.** A tiny static index (e.g., Pagefind) over
  `archive/` so the repo itself becomes searchable without cloning.
- **Media archival.** Download images/video to `archive/media/` (dedupe by
  content hash). Trades storage for resilience against deleted media URLs.
- **Thread unrolling.** When a bookmarked tweet is part of a thread, fetch and
  archive the full thread for context.
- **Embedding-based categorization.** Replace/augment keyword rules with
  embedding similarity once the archive is large enough to define category
  centroids — keeps the deterministic rules as the fast path.
- **Weekly digest.** A generated `archive/_digest/2026-W42.md` summarizing the
  week's bookmarks by category — the "newsletter of your own attention."
- **Annotation UI.** A minimal local web page for editing `note` fields and
  locking categories, committing back to the repo. (Deliberately *not* a
  hosted service.)

### Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-17 | Polling via scheduled runs, not webhooks | X offers no bookmark webhooks; cron is the simplest reliable trigger with no server to operate. |
| 2026-10-17 | GitHub repo as the sink (not a database) | Versioning, diffs, and portability for free; zero infrastructure to maintain; the repo is self-contained including state. |
| 2026-10-17 | JSONL + Markdown dual format | JSON is the source of truth for tooling; Markdown is the browsing surface. Renderer derives one from the other so they can't disagree. |
| 2026-10-17 | Watermark advances only after successful push | Prevents silent data loss: the watermark is a conservative claim ("durably archived up to here") and may lag reality but never lead it. |
| 2026-10-17 | Keyword rules before LLM classification | Deterministic, free, instant for the majority; LLM only for the ambiguous remainder, with provenance tagged. |
| 2026-10-17 | Archive-not-mirror; tombstones, never deletes | A deleted tweet's captured text is the archive's whole point. Absence from poll responses is never treated as deletion. |
| 2026-10-17 | Repo created public; private recommended | The repo was created public at setup. Recommendation stands: bookmarks profile your interests — consider flipping to private unless public archiving is the intent. **Open decision.** |
| 2026-10-17 | Media stored as references, not binaries | Keeps storage/API costs trivial at v1; full media archival is a listed future improvement. |

---

*End of design document. Implementation follows this spec; where code and spec
disagree, update the spec first — the document is the contract.*
