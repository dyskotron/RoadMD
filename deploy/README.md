# Deploying roadmd

`roadmd serve` runs anywhere Node 18+ runs. On Fly.io, one app per project:

1. **A site folder** for the project, outside this repository: its `roadmd.config.json` (storage, states, documents),
   a `fly.toml` (start from [fly.example.toml](fly.example.toml), set `app`), and the documents the config embeds.
   The config names the storage's key variable (`keyEnv`), never the key, and no `envFile`.
2. **Stage** it with the code: `node deploy/stage.mjs <site dir> <out dir>` (out: `app/` roadmd, `site/` the
   project, the `Dockerfile`, the `fly.toml`).
3. **Create the app and its secrets** (from Git Bash: Windows PowerShell 5.1 strips the quotes inside arguments):
   ```bash
   fly apps create <app> --org personal
   printf 'ROADMD_PASSWORD=%s\n<keyEnv>=%s\n' "$PASSWORD" "$KEY" | fly secrets import --stage -a <app>
   ```
4. **Deploy**: `cd <out dir> && fly deploy --remote-only --ha=false`. Check: `curl https://<app>.fly.dev/health`.

The app auto-stops when idle and wakes on the next visit (a few seconds; an Encyclist behind it may wake too).

## roadmd-dev (2026-10-24)

`https://roadmd-dev.fly.dev`: ShooterReborn's board read live from `encyclist-dev.fly.dev`, ShooterReborn's
documents in the image (its `docs/` Markdown, `CLAUDE.md`, the two Assets readmes), behind `ROADMD_PASSWORD`. The
password and the Encyclist key are in `.dev.env` (git-ignored) on Matej's PC. Read only until step 4b.
