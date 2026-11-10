# Prompt for the ArtisDesigns order tool: central job queue API

Paste everything below the line into a Claude Code session opened in the ArtisDesigns repo.

---

You are working in the ArtisDesigns repo (Node/Express API in `server/`, deployed in Docker on the Synology NAS at port 3001, with Etsy and Amazon connectors). Add a **central job queue API** that the gSender CNC software (running on three shop machines) will use to list open jobs, claim one, and report it finished. This tool becomes the single source of truth for job status, and the **only thing that moves job folders on the NAS**. gSender will never move folders itself.

Do not change any existing endpoint. Do not call any platform *write* API (no marking Etsy orders shipped, no Etsy/Amazon updates); carving a sign is not the same as shipping it. Never delete anything on the NAS.

## Background

- The shop's order folders live on the NAS. Layout (all under one directory, call it `SIGNS_DIR`, set by env var):
  - `SIGNS_DIR/ORDERS/<folderName>/` = queued job (a vcarve file plus one or more G-code files: `.nc .gcode .gc .ngc .tap .cnc .ncc`)
  - `SIGNS_DIR/ORDERS/InProgress/<machine>/<folderName>/` = job claimed by a machine
  - `SIGNS_DIR/Carved/<NN>/<folderName>/` = finished, where `<NN>` is the first two characters of `folderName` (Etsy order numbers are 10 digits, so 2 digits; use `Other` if the name does not start with 2 digits). Create `<NN>` if missing.
  - `SIGNS_DIR/ORDERS/SALES/` and other non-order folders must never be touched or listed as jobs.
- `folderName` is the platform order number (for Etsy, the 10-digit `receiptId`). When an order has more than one item, each item has its own folder named `<orderNumber>_<itemIndex>` (for example `4062932387_2`); single-item orders use just `<orderNumber>`.
- You already have `GET /api/etsy/orders` and `normalizeOrders()` in `server/etsy.js`; reuse them. Build the job model so Amazon, Walmart and Shopify adapters can be added later without changing the API.

## Job object (JSON)

```json
{
  "id": "etsy:4214591185:1",
  "platform": "etsy",
  "orderNumber": "4214591185",
  "itemIndex": 1,
  "itemCount": 1,
  "folderName": "4214591185",
  "title": "Custom Northpoint Sign 36\" W x 30\" H White with Black Lettering PVC",
  "quantity": 1,
  "material": "PVC",
  "size": "36x30",
  "color": "White with Black Lettering",
  "personalization": null,
  "shipBy": "2026-11-10",
  "orderedAt": "2026-10-29T00:00:00.000Z",
  "status": "queued",
  "machine": null,
  "claimedAt": null,
  "completedAt": null,
  "gcodeFiles": ["sign.nc"]
}
```

- `id` is `<platform>:<orderNumber>:<itemIndex>` (itemIndex is 1-based). It must be stable.
- `status` is one of `queued`, `in_progress`, `carved`.
- `gcodeFiles` lists G-code file names found in the job's **current** folder (empty array if the folder is missing; still return the job).
- `shipBy` is a `YYYY-MM-DD` string or null. `material`, `size`, `color` are strings, `""` when unknown. **Never guess.**

### Deriving material / size / color

Use the Etsy transaction `variations` and, for custom listings, the title. Examples to cover in unit tests:

| Source | material | size | color |
|---|---|---|---|
| variation `Size & Material` = `24” Wood -Indoor Use`, `Color` = `Copper` | Wood | 24 | Copper |
| `Size & Material` = `18" Weatherproof PVC`, `Color` = `Dark Grey Blue` | PVC | 18 | Dark Grey Blue |
| `Size` = `10x48 inches`, `Color` = `Rosewood` | (blank) | 10x48 | Rosewood |
| title `Custom Farm Sign 24"W x 16" H Black PVC` (no variations) | PVC | 24x16 | Black |
| title `Custom Waterbury Sign 48" Blue and Gold PVC` | PVC | 48 | Blue and Gold |
| title `Custom Tiki Bar Sign 18" PVC DGB` | PVC | 18 | DGB |

Normalise size to the form `WxH` (no spaces, no unit marks) when both dimensions are present, and just the number when only one is given (a square or round sign). Normalise material to `Wood` or `PVC` when recognisable, otherwise keep the raw word. Treat items that are not carved signs (for example "Expedited Shipping Upgrade") as **not jobs**: leave them out of the queue.

## Endpoints

All JSON. If env `QUEUE_API_KEY` is set, require header `X-Api-Key` to match (401 otherwise); if unset, no auth (LAN only). Errors are `{ "error": "message" }`.

1. `GET /api/queue?status=queued,in_progress` returns `{ "jobs": [Job, ...] }`. Default statuses: `queued,in_progress`. Include only open orders (use the platform open-order list; reuse the existing 60-day default window, overridable with `maxAgeDays`) merged with persisted status. A job that is `in_progress` or `carved` in the saved state keeps that status even if the platform list changes. Sort by `shipBy` ascending (nulls last), then order number.
2. `POST /api/queue/:id/claim` with `{ "machine": "Router 1" }` returns `{ "job": Job }`.
   - 404 if the id is unknown, 409 if the job is not `queued` (message names the machine that has it).
   - Atomically (guard with an in-process lock per job id): set `in_progress`, `machine`, `claimedAt`, then move `ORDERS/<folderName>` to `ORDERS/InProgress/<machine>/<folderName>`. If the folder move fails, roll the status back and return 500 with the reason. If the target folder already exists, return 409 and change nothing.
   - `machine` must be a single safe path segment (letters, digits, space, dot, dash, underscore); reject anything else with 400.
3. `GET /api/queue/:id/files/:name` returns the raw file (`text/plain; charset=utf-8`) from the job's **current** folder (queued, in progress or carved). `:name` must be a plain file name with no path separators; 404 if missing.
4. `POST /api/queue/:id/complete` with `{ "machine": "Router 1", "file": "sign.nc", "durationSeconds": 1234, "finishedAt": "2026-11-09T14:03:00Z" }` returns `{ "job": Job }`. `file`, `durationSeconds` and `finishedAt` are optional; store them with the job.
   - Only the machine that claimed the job may complete it (409 otherwise). Completing a job that is already `carved` by the same machine is a no-op success (idempotent).
   - Set `carved`, `completedAt`, then move `ORDERS/InProgress/<machine>/<folderName>` to `Carved/<NN>/<folderName>`. If that destination already exists, use `<folderName> duplicate` (then `duplicate 2`, and so on); never overwrite.
   - After a successful move, call a clearly marked extension point `onJobCompleted(job)` (a no-op logger for now) where later per-platform completion handling will go.
5. `POST /api/queue/:id/release` with `{ "machine": "Router 1" }` returns `{ "job": Job }`: move the folder back to `ORDERS/<folderName>` (409 if one is already there), set `queued`, clear `machine`.

## State and safety

- Persist job status and history in a JSON file next to your existing data file (or the existing `/api/kv` store); it must survive restarts. Write it atomically (temp file then rename).
- All folder moves are plain renames on the same volume; fall back to copy then remove only if the rename fails with `EXDEV`.
- Validate every path segment (no `..`, no separators, not one of `InProgress`, `Carved`, `SALES`). Add env `QUEUE_DRY_RUN=1` that logs the moves it would make and changes nothing on disk.
- Docker: make sure `SIGNS_DIR` is a mounted volume, and document the new env vars (`SIGNS_DIR`, `QUEUE_API_KEY`, `QUEUE_DRY_RUN`) in `.env.example`.

## Tests and deliverables

- Unit tests (use temp directories, never the real NAS) for: material/size/color parsing (the table above), claim race (two simultaneous claims, one wins), complete moves into `Carved/<NN>/` and handles duplicates, release, wrong-machine complete, path traversal rejection, dry-run.
- A short `docs/central-queue.md` describing the endpoints and env vars.
- Keep the code style of the repo. Do not touch unrelated endpoints, and do not run anything against real platform write APIs or the real NAS folders.
- When finished, run the tests, and summarise what you changed, plus any assumption you had to make.
