# CI/CD Pipelines

This repository now includes a comprehensive GitHub Actions setup for automated linting, type checking, testing, image builds, security scanning, and deployment.

All workflow files live in `.github/workflows/`.

## Workflows

1) Lint & Type Check (`lint.yml`)
- Triggers: push/pull_request to `main` and `develop`.
- Matrix over `api-gateway`, `worker`, and `frontend`.
- Runs ESLint (best-effort) and TypeScript type-check per package.
- Uses `npm install` per package directory. ESLint is allowed to soft-fail to avoid blocking if a package lacks a lint script.

2) Unit Tests (`unit-tests.yml`)
- Triggers: push/pull_request to `main` and `develop`.
- Matrix includes `shared-infra`, `worker`, `frontend`, `api-gateway`.
- `shared-infra` runs `npm run test:ci` and uploads coverage to Codecov.
- Other packages run tests if present without failing the workflow.

3) Integration Tests (`integration.yml`)
- Triggers: push/pull_request to `main` and `develop`.
- Brings up Redis (service) and launches MinIO container.
- Installs and builds `shared-infra` and runs `npm run test:integration` inside `shared-infra`.
- Uploads coverage if produced. Collects and uploads MinIO logs on failures.

4) Build & Push Docker Images (`docker-build.yml`)
- Triggers: push to `main`, `develop`, and `v*` tags; pull requests to `main`.
- Builds images for `worker` and `storage-service` and pushes to GHCR when not a PR.
- Multi-platform support via Buildx and rich metadata tagging.

5) E2E Tests (`e2e.yml`)
- Triggers: push/pull_request to `main`; nightly at 02:00 UTC.
- Starts services using `shared-infra/docker-compose.yml` and waits for health.
- Runs E2E tests if present, uploads report if generated, and always tears down services.

6) Security Scanning (`security.yml`)
- Triggers: push to `main`/`develop`, PRs to `main`, weekly on Sunday.
- Dependency audit runs across root and key package folders.
- Container scan builds `worker` and `storage-service` images and scans them using Trivy, uploading SARIF results.

7) Deploy (`deploy.yml`)
- Triggers: push to `main` (staging), `v*` tags or manual dispatch (production).
- Staging deploys via SSH to a remote host using `docker-compose`.
- Optional smoke tests for staging/production and Slack notifications.

8) PR Checks Summary (`pr-checks.yml`)
- Triggers on PRs to `main`/`develop` and posts a brief summary. Branch protection should enforce the main checks listed below.

## Branch Protection (configure in GitHub Settings)
- Require PR reviews before merging.
- Require status checks to pass:
  - Lint & Type Check
  - Unit Tests
  - Integration Tests
- Require branches to be up to date.
- Require conversation resolution.

## Repository Secrets
Create these in GitHub repository settings → Secrets and variables → Actions:
- `STAGING_SSH_KEY`
- `STAGING_USER`
- `STAGING_HOST`
- `PRODUCTION_SSH_KEY` (if using production SSH deployment)
- `PRODUCTION_USER`
- `PRODUCTION_HOST`
- `SLACK_WEBHOOK` (for notifications)
- `CODECOV_TOKEN` (only if the repo is private or Codecov requires it)
- `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` (only if Docker Hub is used)

## Notes and Alignments
- This repo does not include `package-lock.json` files. Workflows use `npm install` rather than `npm ci` for compatibility. Consider adding lockfiles for reproducible builds and faster caches.
- `frontend` currently sits outside the root npm workspaces; the workflows run per-directory to accommodate this. You can optionally add `frontend` to the root `workspaces` to simplify installs.
- Docker builds target images that have Dockerfiles: `worker` and `shared-infra/packages/storage-service`. Update matrices and Dockerfiles if/when `api-gateway` or `frontend` containerization is added.
- E2E and smoke test scripts are invoked with `--if-present` to avoid failures if not yet implemented. Add scripts to tighten the checks.

## Expected Outcomes
- Every push triggers linting and type checking.
- Every PR triggers tests (unit/integration) and summaries.
- Main branch deployments go to staging; tagged releases can deploy to production.
- Docker images are built and pushed automatically for available services.
- Security scans run on schedule.
- Dependencies are updated automatically by Dependabot.
