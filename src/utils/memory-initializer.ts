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

The Heartbeat Service is Tars' background maintenance engine. It runs on a configurable interval and manages:

- **Memory Synchronization** - Re-indexes facts, skills, and session histories
- **Filesystem Cleanup** - Removes stale temp files and attachments
- **Stale Run Watchdog** - Warns (advisory only) when a live run exceeds 10 minutes
- **Initiative Check** - Runs the autonomous doctor / repair / notification pass

Autonomous **agent wakes** are separate: the Pulse Service reads
\`~/.tars/workspace/HEARTBEAT.md\` and runs your checklist as an agent turn. An
empty checklist (only \`#\` comment lines) costs zero API calls. Wakes pace
themselves: while the result is unchanged the delay doubles up to \`ceilingSec\`;
any change snaps back to \`floorSec\`. Quiet wakes reply \`[SILENT]\` and never
message you; the agent uses \`send_notification\` only for genuinely important
findings.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| \`heartbeatIntervalSec\` | 300s (5 min) | How frequently the maintenance tick runs |
| \`pulse.enabled\` | \`true\` | Enable autonomous agent wakes |
| \`pulse.floorSec\` | 300s | Minimum delay between wakes |
| \`pulse.ceilingSec\` | 3600s | Maximum backoff while nothing changes |
| \`pulse.activeHoursStart/End\` | 7 / 23 | Local hours when wakes may run (start=end disables the window) |
| \`SYNC_INTERVAL_MS\` | 1 hour | Minimum time between memory syncs |

**Edit:** \`~/.tars/config.json\` → \`heartbeatIntervalSec\`, \`pulse.*\`
(Env overrides: \`HEARTBEAT_INTERVAL_SEC\`, \`TARS_PULSE_ENABLED\`, \`TARS_PULSE_FLOOR_SEC\`, \`TARS_PULSE_CEILING_SEC\`, \`TARS_PULSE_ACTIVE_START\`, \`TARS_PULSE_ACTIVE_END\`)
The legacy \`heartbeatRunAgent: false\` setting is honored as \`pulse.enabled: false\`.

## Tick Execution Flow

\`\`\`
heartbeat.tick()                       pulse wake (self-paced)
  ├── Already executing? → Skip         ├── HEARTBEAT.md empty? → Skip (no API call)
  ├── Busy >10min? → Log advisory       ├── Outside active hours? → Skip
  ├── Cleanup temp files                ├── Supervisor busy? → Skip (owner wins)
  ├── Memory re-index + session GC      ├── Run checklist + previous-wake marker
  └── Initiative doctor pass            └── [SILENT]/unchanged → back off; changed → floor
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
