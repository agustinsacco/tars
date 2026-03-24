---
name: swarm-ops
description: Guide for managing Tars Swarm — registering peers, enabling swarm mode, and troubleshooting A2A connectivity.
---

# Tars Swarm Operations

Use this skill when the user wants to connect Tars instances together, register remote agents, or troubleshoot swarm connectivity.

## What is Swarm Mode?

Swarm Mode allows multiple Tars instances to communicate using the A2A (Agent-to-Agent) protocol. When enabled, this Tars instance exposes an HTTP endpoint that other agents can discover and delegate tasks to. Similarly, this instance can delegate tasks to other registered peers.

## Key Concepts

- **Swarm Mode**: An opt-in feature that starts an A2A HTTP server alongside the supervisor.
- **Agent Card**: A JSON document at `/.well-known/agent.json` describing this instance's capabilities.
- **Peer**: Another Tars instance (or any A2A-compliant agent) registered as a remote agent.
- **API Key**: Each swarm-enabled instance has a unique key for authenticating incoming requests.

## CLI Commands

### Check Swarm Status

```bash
tars swarm status
```

Shows whether swarm mode is enabled, the port, API key (masked), and registered peers.

### Register a Peer

```bash
tars swarm add
```

Interactive prompt that asks for:

1. **Peer name** — lowercase, no spaces (e.g., `case`, `stark-worker`)
2. **Agent Card URL** — the peer's discovery endpoint (e.g., `http://stark:3100/.well-known/agent.json`)
3. **API Key** — the peer's `SWARM_API_KEY`

This creates a `.md` file in `~/.tars/.gemini/agents/<name>.md` that Gemini Core's AgentRegistry automatically picks up on restart.

### Remove a Peer

```bash
tars swarm remove <name>
```

Removes the peer's agent `.md` file and its API key from secrets. Only removes remote agents — local agents (like `t-scaffolder`) are protected.

### List Peers

```bash
tars swarm list
```

Lists all registered remote peers with their names and URLs.

## Setup Workflow

### Enabling Swarm on This Instance

If swarm mode is not yet enabled:

1. Tell the user to run `tars setup` and enable Swarm Mode in Step 7
2. Setup will auto-generate an API key and save it to secrets
3. After setup, tell the user to run `tars restart` for changes to take effect

**CRITICAL: Never run `tars restart` yourself. Always instruct the USER to do it.**

### Connecting Two Tars Instances

To connect **Tars** (this instance) and **Case** (another instance):

**On Case's machine:**

1. Run `tars setup`, enable Swarm Mode
2. Note the API key and the hostname/port (e.g., `http://stark:3100`)

**On this machine (Tars):**

1. Run: `tars swarm add`
2. Enter name: `case`
3. Enter URL: `http://stark:3100/.well-known/agent.json`
4. Enter Case's API key
5. Run: `tars restart`

**On Case's machine (reverse registration):**

1. Run: `tars swarm add`
2. Enter name: `tars`
3. Enter URL: `http://<this-host>:3100/.well-known/agent.json`
4. Enter this instance's API key
5. Run: `tars restart`

After both sides are registered, either agent can delegate tasks to the other.

## Configuration Reference

### config.json (Swarm Section)

```json
{
    "swarm": {
        "enabled": true,
        "port": 3100,
        "description": "Tars on Stark — DevOps specialist",
        "skills": ["devops", "deployment"]
    }
}
```

- `enabled` — Whether the A2A server starts (default: `false`)
- `port` — HTTP port for the A2A server (default: `3100`)
- `description` — Human-readable description shown in the agent card
- `skills` — Additional skill tags advertised in the agent card

### Secrets

- `SWARM_API_KEY` — This instance's API key (auto-generated during setup)
- `SWARM_PEER_<NAME>_KEY` — API keys for registered peers (set by `tars swarm add`)

## Troubleshooting

### Peer Not Reachable

```bash
# Test connectivity to a peer's agent card
curl http://<peer-host>:3100/.well-known/agent.json

# Test the health endpoint
curl http://<peer-host>:3100/health
```

If these fail, check:

- Is swarm mode enabled on the peer? (`tars swarm status`)
- Is the port open/accessible? (firewall, SSH tunnel)
- Is the peer's Tars running? (`tars status`)

### Authentication Errors

If you see `401 Unauthorized` in logs:

- Verify the API key matches: check `SWARM_API_KEY` on the peer vs `SWARM_PEER_<NAME>_KEY` on this instance
- Keys are stored in `~/.tars/.env` — use `tars secret list` to verify

### Port Conflicts

If swarm fails to start with `EADDRINUSE`:

- The port is already in use (dashboard, another service)
- Change the port in `config.json` under `swarm.port`
- Default swarm port is `3100` (dashboard defaults to `3000`)

## Safety Rules

1. **NEVER restart Tars yourself** — always instruct the user to run `tars restart`
2. **Loop prevention** — The `X-Swarm-Depth` header caps delegation at 3 levels deep. You cannot create infinite loops.
3. **API keys are secrets** — Never display full API keys in chat. Show only masked versions (first 12 chars + last 4).
4. **Swarm is opt-in** — Never enable swarm mode without the user's explicit request.
