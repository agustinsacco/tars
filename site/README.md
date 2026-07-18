# Tars documentation site

The published documentation is an Astro 7 site with React islands and Tailwind CSS. Markdown routes
live under `src/pages/`; shared navigation and search metadata live in `src/lib/navigation.ts`.

## Local development

From the repository root:

```bash
npm ci --prefix site
npm run docs:dev
```

The development server defaults to `http://localhost:4321`.

## Production validation

```bash
npm run docs:check
npm run docs:build
npm run preview --prefix site
```

The static output is written to `site/dist/`. The CI validation workflow installs from the site
lockfile, runs the Astro check, and performs the same production build.

## Add a page

1. Add a Markdown file under the appropriate `src/pages/` directory using `DocLayout.astro`.
2. Add its title, route, summary, and optional search keywords once in `src/lib/navigation.ts`.
3. Link to implemented behavior and state important limitations explicitly.
4. Run the production build and check that the generated route appears in the build output.

## Deployment

Changes to `site/**`, `.infra/tars-docs/**`, or the deployment workflow build a container image tagged
with the Git commit SHA and deploy its immutable registry digest to Kubernetes. The workflow waits
for rollout completion. `latest` is also published for discovery but is not the deployed rollout
identity.
