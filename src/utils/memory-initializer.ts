/**
 * Creates initial memory/directive files if they don't exist.
 * This ensures new Tars instances have proper documentation and guides.
 */
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

const INITIAL_MEMORY_FILES = [
    {
        name: 'heartbeat.md',
        content: `# Heartbeat Service Directives

## Overview

The Heartbeat Service is Tars' autonomous background engine. It runs on a configurable interval and manages:

- **Memory Synchronization** - Re-indexes facts, skills, and session histories
- **Filesystem Cleanup** - Removes stale temp files and attachments
- **Stale Run Watchdog** - Warns (advisory only) when a live run exceeds 10 minutes
- **Initiative Check** - Runs the autonomous doctor / repair / notification pass
- **Agent Work (opt-in)** - Optionally runs an agent turn to manage tasks and do already-authorized work

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| \`heartbeatIntervalSec\` | 300s (5 min) | How frequently the heartbeat tick runs |
| \`heartbeatRunAgent\` | \`false\` | Run an agent turn every heartbeat to manage tasks / do work |
| \`heartbeatAgentPrompt\` | (built-in directive) | The directive passed to the agent when \`heartbeatRunAgent\` is on |
| \`SYNC_INTERVAL_MS\` | 1 hour | Minimum time between memory syncs |

**Edit:** \`~/.tars/config.json\` → \`heartbeatIntervalSec\`, \`heartbeatRunAgent\`, \`heartbeatAgentPrompt\`
(Env overrides: \`HEARTBEAT_INTERVAL_SEC\`, \`HEARTBEAT_RUN_AGENT\`, \`HEARTBEAT_AGENT_PROMPT\`)

### Autonomous agent turns

When \`heartbeatRunAgent\` is enabled, each heartbeat tick invokes the agent with
\`heartbeatAgentPrompt\` after maintenance and the initiative pass, so it sees freshly
synced memory. This runs regardless of user activity. It is opt-in and disabled by
default because every enabled tick is a full inference run (mind your
\`heartbeatIntervalSec\` and rate limits). The invocation never interrupts a live
conversation: if the supervisor is busy, the agent turn is skipped for that tick, and
agent failures never abort the heartbeat.

## Tick Execution Flow

\`\`\`
heartbeat.tick()
  ├── Check: Already executing? → Skip (concurrency guard)
  ├── Warn: Supervisor busy >10min? → Log advisory (live run stays locked)
  ├── Cleanup: Remove stale temp files (>1h) and uploads (>24h)
  ├── Sync: Memory re-index + session GC (rate-limited to 1h minimum)
  ├── Initiative: Run doctor / repairs / notifications
  └── Agent (opt-in): Run a task-management agent turn when heartbeatRunAgent is on
\`\`\`

## Logging & Traceability

| Log File | Location | Purpose |
|----------|----------|---------|
| \`supervisor.log\` | \`~/.tars/logs/supervisor.log\` | Daemon/background mode logs |
| \`chat.log\` | \`~/.tars/logs/chat.log\` | Interactive chat mode logs |
| \`session.json\` | \`~/.tars/data/session.json\` | Activity timestamps, token usage |

**Log Levels:**
- \`info\` - Service start/stop, memory syncs
- \`debug\` - Every tick start/complete, agent invocation lifecycle (full traceability)
- \`warn\` - Long-running supervisor run (advisory only)
- \`error\` - Tick failures

## User Activity Tracking

Every user prompt updates \`lastUserInteractionAt\` in \`session.json\`:

\`\`\`json
{
  "lastUserInteractionAt": "2026-07-15T14:27:55.144Z"
}
\`\`\`

The heartbeat no longer skips work when idle — maintenance, initiative, and (when enabled)
agent turns run regardless of user activity. This timestamp is kept for observability only.

## Troubleshooting

### No Heartbeat Logs Visible?

1. Check if daemon logging is enabled: Look for "Daemon logging enabled" in logs
2. Verify config: \`cat ~/.tars/config.json | grep heartbeatIntervalSec\`
3. Check PM2 logs (if using PM2): \`~/.pm2/logs/tars-supervisor-out.log\`

### Heartbeat Not Running?

1. Verify supervisor process: \`ps aux | grep main.js\`
2. Check startup logs: Look for "Heartbeat service started"
3. Restart supervisor: Stop current process and restart with \`TARS_SUPERVISOR_MODE=true\`

## Related Files

- **Implementation:** \`~/.tars/apps/tars/src/supervisor/heartbeat-service.ts\`
- **Bootstrap:** \`~/.tars/apps/tars/src/supervisor/bootstrap.ts\`
- **Logger:** \`~/.tars/apps/tars/src/utils/logger.ts\`
- **Config:** \`~/.tars/config.json\`
- **Session:** \`~/.tars/data/session.json\`
`
    }
];

/**
 * Initializes the data/memory directory with default directive files.
 * Only creates files that don't already exist (preserves user modifications).
 */
export async function initializeMemoryFiles(homeDir: string): Promise<void> {
    const memoryDir = path.join(homeDir, 'data', 'memory');

    if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
    }

    let createdCount = 0;

    for (const file of INITIAL_MEMORY_FILES) {
        const filePath = path.join(memoryDir, file.name);

        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, file.content, 'utf-8');
            logger.debug(`📝 Created memory file: ${file.name}`);
            createdCount++;
        }
    }

    if (createdCount > 0) {
        logger.info(`✨ Initialized ${createdCount} memory directive file(s)`);
    }
}
