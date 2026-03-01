# Contributing to Tars

We welcome contributions! To ensure a high-quality codebase, we use automated validation workflows.

## Development Workflow

1.  **Fork and Clone**: Create a fork of the repository and clone it locally.
2.  **Install Dependencies**: Run `npm install` in the `apps/tars` directory.
3.  **Create a Branch**: Create a new branch for your feature or fix.
4.  **Make Changes**: Write code and follow the style guide.
5.  **Validate Locally**:
    *   `npm run lint` to check formatting.
    *   `npm run build` to ensure the project compiles.
    *   `npm test` to run tests.
6.  **Submit a Pull Request**: Push your branch and open a PR against `main`.

## Continuous Integration (CI)

Every Pull Request triggers the following checks:
- **Lint**: Ensures code follows Prettier formatting rules.
- **Build**: Verifies that the source and extensions build correctly.
- **Test**: Runs the full test suite via Vitest.

All checks must pass before a PR can be merged.

## Releasing and Publishing

We use [Release Please](https://github.com/googleapis/release-please) to automate our versioning and releases.
- When you merge a PR into `main`, Release Please will update a "Release PR" that tracks all changes since the last release.
- When the Release PR is merged, it will create a new GitHub Release and a version tag (e.g., `v1.0.54`).
- This tag triggers the publishing workflow, which automatically publishes the new version to NPM.

Thank you for contributing!
