# Contributing to Tars

Thank you for contributing. Keep changes focused, include verification, and describe user-visible
behavior and limitations plainly.

## Set up the repository

Requirements:

- Node.js 22.19 or newer
- npm 10.9 or newer
- Git

```bash
git clone https://github.com/agustinsacco/tars.git
cd tars
npm ci
npm run ci:extensions
npm run check
npm run build
npm run test:extensions
```

The Astro documentation site and the dashboard have their own lockfiles:

```bash
npm ci --prefix site
npm ci --prefix dash
```

Built-in extensions also have independent packages under `extensions/`.

## Make a change

1. Create a branch from current `main`.
2. Keep the patch limited to one concern.
3. Add or update tests for behavior changes.
4. Update user and operator documentation when a command, configuration key, security control, or
   limitation changes.
5. Run the relevant validation commands.

Use TypeScript with explicit types at I/O boundaries. Validate external data instead of asserting
its shape, avoid `any`, keep functions focused, and preserve the ES module conventions already used
by the project.

## Validate locally

For core changes:

```bash
npm run check
npm run build:src
npm run test:extensions
```

For an extension, replace `tasks` with the affected extension:

```bash
npm ci --prefix extensions/tasks
npm run build --prefix extensions/tasks
```

For web surfaces:

```bash
npm ci --prefix dash
npm run dashboard:lint
npm run dashboard:typecheck
npm run dashboard:build

npm ci --prefix site
npm run docs:check
npm run docs:build
```

Before release-sensitive changes, inspect the package contents without publishing:

```bash
npm pack --dry-run --ignore-scripts
```

CI runs formatting and linting, core build and tests, each built-in extension build, dashboard
lint/type/test/build checks, the documentation build, dependency audits, and a package smoke check.

## Pull requests and commits

- Use a Conventional Commit title such as `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, or
  `chore:`.
- Explain the problem, approach, verification, and any remaining limitation.
- Keep generated output, credentials, logs, backups, and local Tars state out of the patch.
- Do not weaken an access-control or data-safety default without a clear rationale and tests.

## Releases

Release Please maintains the release pull request, package version, changelog, tag, GitHub release,
and npm publish flow. Do not edit the version in `package.json` manually. Merge normal feature and
fix pull requests first, then merge the generated release pull request when it is ready.
