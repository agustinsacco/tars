# Multi-Channel Architecture Plan (Discord & WhatsApp)

## 1. Overview

This plan outlines the transition of Tars from a Discord-only assistant to a modular, multi-channel platform. The primary goal is to support **WhatsApp** (via the Baileys library) while ensuring full backward compatibility with the existing Discord integration.

## 2. Core Architecture Changes

### 2.1 Channel Interface

We will introduce a standardized `CommunicationChannel` interface to decouple the messaging platform from the Tars brain (Supervisor).

```typescript
// src/channels/types.ts
export interface ChannelMessage {
    content: string;
    senderId: string;
    senderName: string;
    channelId: string; // Internal channel reference
    attachments?: AttachmentContext[];
    reply: (content: string, attachments?: string[]) => Promise<void>;
}

export interface CommunicationChannel {
    id: string; // e.g., 'discord', 'whatsapp'
    isEnabled: boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    notify(content: string, attachments?: string[]): Promise<void>; // Proactive notifications
    onMessage(handler: (message: ChannelMessage) => Promise<void>): void;
}
```

### 2.2 Channel Manager

A new `ChannelManager` class will orchestrate all enabled channels.

- **Discovery**: Reads `config.json` to determine which channels to initialize.
- **Routing**: Receives messages from any channel and forwards them to the `Supervisor`.
- **Broadcast**: Provides a unified `notify()` method that sends alerts to the configured "Primary" channel.

### 2.3 Decoupling the Supervisor

The `Supervisor` will no longer depend on `DiscordBot`. Instead, it will interact with the `ChannelManager`.

## 3. Implementation Phases

### Phase 1: Refactoring & Abstraction (Current Focus)

1.  **Move Discord Logic**: Relocate `src/discord/*` to `src/channels/discord/*`.
2.  **Implement Interface**: Refactor `DiscordBot` into `DiscordChannel` implementing `CommunicationChannel`.
3.  **Config Migration**: Update `src/config/config.ts` to support nested channel configurations.
4.  **Backward Compatibility**: Ensure that if only Discord is configured in the old format, it still works.

### Phase 2: WhatsApp Integration

1.  **Dependency**: Add `@whiskeysockets/baileys` for lightweight, QR-based WhatsApp authentication.
2.  **Implementation**: Create `src/channels/whatsapp/whatsapp-channel.ts`.
3.  **Session Management**: Store WhatsApp authentication state in `~/.tars/data/whatsapp-session/`.

### Phase 3: Generic Notifications

1.  **Tool Update**: Create a new `send_notification` MCP tool.
2.  **Deprecation**: Mark `send_discord_message` as deprecated (aliased to `send_notification`).

## 4. Configuration Schema

We are moving away from flat `.env` variables toward structured settings in `config.json`.

```json
{
    "assistantName": "Tars",
    "geminiModel": "gemini-2.5-flash",
    "heartbeatIntervalSec": 300,
    "channels": {
        "discord": {
            "enabled": true,
            "token": "DISCORD_TOKEN_SECRET",
            "ownerId": "USER_ID"
        },
        "whatsapp": {
            "enabled": false,
            "ownerNumber": "1234567890",
            "sessionPath": "path/to/session"
        }
    },
    "primaryChannel": "discord"
}
```

_Note: Secrets like `token` will still be referenced via `SecretsManager` which pulls from the encrypted vault or `.env`._

## 5. CLI & Setup Updates

The `tars setup` command will be updated with a new "Channels" step:

1.  **Selection**: "Which channels would you like to enable? [ ] Discord [ ] WhatsApp".
2.  **Sub-Wizards**: If WhatsApp is chosen, prompt for the owner's phone number. If Discord is chosen, prompt for the Bot Token.
3.  **QR Handshake**: For WhatsApp, the first `tars start` after setup will display the QR code in the terminal.

## 6. Verification Plan

- **Unit Tests**: Test the `ChannelManager` with mock channels.
- **Integration Tests**: Verify the `Supervisor` correctly receives messages from multiple sources.
- **Regression**: Ensure `tars start` still connects to Discord without changes for existing users.

## 7. Future Extensibility

This architecture makes it trivial to add:

- **Telegram** (via `telegraf`)
- **Slack** (via `@slack/bolt`)
- **Web Dashboard Chat** (via Socket.io)
