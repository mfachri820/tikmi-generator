# Google Form → TIKMI Generator (Apps Script)

`Code.gs` sends every response of the TIKMI form, and every edit of a response, to the app. An edited response arrives with the same response ID and becomes a new version; the latest valid one is active.

## What it sends

1. `POST /api/ingest/start`: response ID, timestamp, respondent email, the PJP dropdown answer and its "Other" text, Bundling Aktivitas, every answer keyed by item ID (with title and section), and the uploaded files' names and sizes. The app records a new version, matches the PJP name, and answers with one upload target per file.
2. Each file. If every file is ≤ 3 MB, it goes as base64 to `POST /api/ingest/file`. Otherwise it is PUT straight into the app's private storage with a one-time signed URL, so it never hits Vercel's 4.5 MB request limit.
3. `POST /api/ingest/complete`. The app parses and validates the files, decides which version is active, and applies it. The execution log shows the reply.

Every request carries `x-tikmi-timestamp` and `x-tikmi-signature` (hex HMAC-SHA256 of `<timestamp>.<body>` with `FORM_INGEST_SECRET`). The app refuses requests older than 10 minutes.

## Setup

1. Open the form, then **⋮ > Apps Script**. Paste `Code.gs`. (For a standalone project at script.google.com, also set `FORM_ID`, the ID in the form's edit URL.)
2. Go to **Project Settings > Script Properties** and add:
   - `INGEST_URL`: the app's base URL, e.g. `https://tikmi-generator.vercel.app`
   - `FORM_INGEST_SECRET`: the same value as the app's `FORM_INGEST_SECRET` environment variable (a long random string)
   - `FORM_ID`: standalone project only
3. Run `dumpItems()` and read the execution log: one line per item, `ID | type | section | title`. Check that the patterns in `ITEMS` (top of `Code.gs`) match the PJP dropdown, the "(Jika memilih Other)" text question, "Bundling Aktivitas", and the two upload questions in Bagian 2 and 3. Both IT upload questions are titled "Upload Asesmen Mandiri Infrastruktur TI"; that is fine, because a response only ever answers the section of its bundling.
4. Run `installTrigger()` once and accept the permissions (form, Drive read, external requests).
5. Run `testLatestResponse()` and check the log for `status: processed`, plus the PJP page in the app.

`resendAllResponses()` sends every response again, oldest first. Use it to backfill after setup or after a fix. Re-running is safe, because the latest submission stays active.

## When something fails

- A failed run is marked under **Executions** and Google emails the script owner. The error names the step and the app's reply.
- `401 Invalid signature` / `stale timestamp`: the secret differs from the app's, or the clock is off.
- `Nama PJP belum dikenali`: the name (or the "Other" text) is not yet in the PJP master. An admin confirms it on the PJP review page; the waiting submission is then processed automatically.
- `File too large for direct upload`: the app has no Supabase Storage configured and the file is over 3 MB. Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on the app.
