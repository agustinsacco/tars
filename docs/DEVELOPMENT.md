# Tars Development Guide

This guide covers how to set up the Tars project for local development.

## Prerequisites

- **Node.js**: Version 22.0.0 or higher.
- **Gemini CLI**: Must be installed and available in your PATH (`npm i -g @google/gemini-cli-beta`).
- **Discord Bot Token**: proper permissions (Send Messages, Read Message History).

## Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/agustinsacco/tars.git
    cd tars
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```
    *Note: This also installs dependencies for the built-in `extensions/tasks`.*

3.  **Build the project**:
    ```bash
    npm run build
    ```
    This compiles the TypeScript source from `src/` to `dist/` and builds the internal extensions.

4.  **Link globally**:
    ```bash
    npm link
    ```
    This makes the `tars` command available globally on your system, pointing to your local `dist/cli/index.js`.

5.  **Run Setup**:
    ```bash
    tars setup
    ```
    Follow the wizard to authenticate with Google and configure your Discord token.

## Development Workflow

### Running in Watch Mode

For rapid development, you can run the Supervisor directly using `tsx` in watch mode:

```bash
npm run dev
```

This bypasses the `pm2` process management and runs the Supervisor in your current terminal, streaming logs directly.

### Testing Extensions

If you modify `extensions/tasks/`:

1.  Rebuild the extension:
    ```bash
    npm run build:extensions
    ```
2.  Restart Tars (if running via `tars start`):
    ```bash
    tars stop && tars start
    ```

### Running Tests

Tars uses `vitest` for testing.

- **Run all tests**:
    ```bash
    npm test
    ```
- **Run in watch mode**:
    ```bash
    npm run test:watch
    ```

## Project Structure

- **`src/cli/`**: The `commander`-based CLI tool (`tars`).
- **`src/supervisor/`**: The core logic (Supervisor, Heartbeat, Gemini wrapper).
- **`src/discord/`**: Discord bot integration.
- **`extensions/`**: Built-in MCP servers (e.g., `tasks`).
- **`context/`**: Static assets copied to `~/.gemini` (GEMINI.md, skills).

## Debugging

- **Logs**: When running via `tars start` (pm2), logs are managed by pm2:
    ```bash
    pm2 logs tars-supervisor
    ```
- **Data**: Check `~/.tars/data/` to see the state of `tasks.json` and `session.json`.
