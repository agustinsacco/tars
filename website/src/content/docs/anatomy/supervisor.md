---
title: The Frontal Lobe (Supervisor)
description: Internal logic and orchestration of Tars.
---

The **Supervisor** is the executive center of Tars. It is responsible for high-level decision making, session management, and routing interactions between the user and the Gemini models.

## Executive Functions

1. **Session Orchestration**: Manages the lifecycle of conversation threads, ensuring that context is preserved through a `sessionId`.
2. **Conflict Resolution**: Prevents multiple processes from accessing the brain simultaneously.
3. **Event Routing**: Streams real-time thoughts and tool execution results back to the interface (Discord).
4. **Task Execution**: Acts as the gatekeeper for both manual user requests and autonomous heartbeat tasks.

## Technical Implementation

The Supervisor is implemented as a Node.js class that wraps the `GeminiCli`. It tracks:
- **Interaction Counting**: To help manage context size.
- **Token Usage**: Monitoring performance and cost.
- **Lock State**: Ensuring atomic operations.

```typescript
// Example of how the Supervisor locks the brain
this.lock();
try {
  await this.gemini.run(prompt);
} finally {
  this.unlock();
}
```
