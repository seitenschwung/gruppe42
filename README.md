# Project template

Starting point for new projects made with `dev <name>` (claude-dev kit). It brings:

- `CLAUDE.md`: a skeleton the box fills in during its first session
- a working demo site (`public/`, `Dockerfile`, `nginx.conf`) that meets the deploy contract, so CI
  is green from the first commit. Replace it with the real project.
- `.github/workflows/ci.yml`: a thin caller. The pipeline itself (checks, hardened Docker test,
  browser tests, deploy to Coolify after green CI on `main`) is `pipeline.yml` in this repository,
  shared by all projects as `seitenschwung/template/.github/workflows/pipeline.yml@v1`
- `docker-compose.yml`: what Coolify runs (the image tested by CI), with the CrowdSec labels and log rotation
- `.gitignore`, `.dockerignore`, a PR template

## Changing the shared pipeline (owner)

Projects follow the moving tag `v1`. After a tested change to `pipeline.yml` on `main`, move it:
`git tag -f v1 && git push -f origin v1`. A breaking change gets `v2`; projects switch by editing
the `uses:` line in their `ci.yml`. Test changes on a branch by pointing this repository's own
`ci.yml` at that branch (`...pipeline.yml@<branch>`), and set it back to `@v1` before merging.
This repository's CI runs the demo through the pipeline, so a green run is the template's self-test.

Replace this README with one about the project.

## Setting up the deploy (owner, once per project)

Nothing deploys until `COOLIFY_APP_UUID` is set, so CI stays green before that.

1. **Coolify:** New Resource → this repository → Build Pack **Docker Compose**. Give the
   service `web` the domain `https://<domain>:8080`. The server needs a `docker login ghcr.io`
   (a token with `read:packages`) if the repository is private.
2. **GitHub → Settings → Environments → `production`:**
   - secrets `COOLIFY_TOKEN` (Coolify API token with read, write and deploy),
     `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` (Tailscale OAuth client with tag `tag:ci`)
   - variables `COOLIFY_URL` (Coolify on the tailnet) and `APP_URL` (`https://<domain>`)
3. **GitHub → Settings → Secrets and variables → Actions → Variables (repository):**
   `COOLIFY_APP_UUID`. It must be a repository variable, since it decides whether the deploy
   job runs at all.
4. Optional: `BROWSER_TESTS=off` (repository variable) for a project without a web UI.

The deploy steps live in the workflow on purpose: the bot that writes the code can't change
workflow files, so it can't change what runs with the deploy secrets.
