# Tars dashboard

The dashboard is the optional local web interface bundled with the Tars npm package. The supervisor
installs it under `~/.tars/apps/dashboard`, starts it through PM2 when `DASH_ENABLED=true`, and keeps
it disabled unless `DASH_PASSWORD` meets the current policy.

The server binds to `127.0.0.1` by default. Keep it on loopback and use an authenticated tunnel for
remote access; Basic authentication is not a substitute for TLS or a trusted network boundary.

## Validate a change

From the repository root:

```bash
npm ci --prefix dash
npm run dashboard:lint
npm run dashboard:typecheck
npm run dashboard:test
npm run dashboard:build
```

The dashboard security helpers are exercised by the core Vitest suite. Validate route, Socket.IO,
and browser behavior manually when changing their integration points.

## Operate the installed dashboard

Use `tars setup` to enable or reconfigure it. Use `tars refresh --dashboard-only` to stage, build, and
replace the installed assets, and use `tars restart` to restart active processes without installing a
package update. See the
[operations guide](https://github.com/agustinsacco/tars/blob/main/docs/OPERATIONS.md) for the access
and recovery model.
