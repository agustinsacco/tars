# Dashboard deployment

The dashboard is deployed as part of a Tars installation rather than as a separate public service.

Requirements:

- Node.js 22.19 or newer;
- a configured Tars home;
- `DASH_ENABLED=true`;
- `DASH_HOST=127.0.0.1` unless an operator has supplied another trusted network boundary;
- a non-default `DASH_PASSWORD` containing at least 16 characters.

Run `tars setup` to configure and install the dashboard. The supervisor starts the installed copy
through PM2 using the configured instance name. For an asset update, run:

```bash
tars refresh --dashboard-only
tars restart
```

Refresh builds in a staging directory and replaces the installed dashboard only after validation.
Keep TLS and any remote-access gateway outside the dashboard process.
