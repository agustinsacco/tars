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

The Heartbeat Service is Tars' autonomous background maintenance engine. It runs on a configurable interval and manages:

- **Memory Synchronization** - Re-indexes facts, skills, and session histories
- **Filesystem Cleanup** - Removes stale temp files and attachments
- **Stale Lock Recovery** - Detects and releases stuck supervisor locks
- **Idle Suppression** - Skips background work when user has been inactive

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| \`heartbeatIntervalSec\` | 300s (5 min) | How frequently the heartbeat tick runs |
| \`IDLE_THRESHOLD_MS\` | 2 hours | Skip ticks if user inactive longer than this |
| \`SYNC_INTERVAL_MS\` | 1 hour | Minimum time between memory syncs |

**Edit:** \`~/.tars/config.json\` → \`heartbeatIntervalSec\`

## Tick Execution Flow

\`\`\`
heartbeat.tick()
  ├── Check: User idle? → Skip if >2h since last interaction
  ├── Check: Already executing? → Skip (concurrency guard)
  ├── Check: Stale supervisor lock? → Release if >10min old
  ├── Cleanup: Remove stale temp files (>1h) and uploads (>24h)
  └── Sync: Memory re-index (rate-limited to 1h minimum)
\`\`\`

## Logging & Traceability

| Log File | Location | Purpose |
|----------|----------|---------|
| \`supervisor.log\` | \`~/.tars/logs/supervisor.log\` | Daemon/background mode logs |
| \`chat.log\` | \`~/.tars/logs/chat.log\` | Interactive chat mode logs |
| \`session.json\` | \`~/.tars/data/session.json\` | Activity timestamps, token usage |

**Log Levels:**
- \`info\` - Service start/stop, memory syncs
- \`debug\` - Every tick start/complete (full traceability)
- \`warn\` - Stale lock releases
- \`error\` - Tick failures

## User Activity Tracking

Every user prompt updates \`lastUserInteractionAt\` in \`session.json\`:

\`\`\`json
{
  "lastUserInteractionAt": "2026-07-15T14:27:55.144Z"
}
\`\`\`

Heartbeat checks this timestamp and skips work if idle > 2 hours.

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
