---
layout: ../../layouts/DocLayout.astro
title: WhatsApp Integration
description: Interact with Tars securely from your mobile device via WhatsApp.
section: Get Started
---

WhatsApp serves as a mobile-first, native communication channel for Tars. It allows you to control your infrastructure naturally from your phone without needing a separate app or relying on a desktop.

### How It Works

The integration uses the `@whiskeysockets/baileys` library to establish a secure, multi-device Web connection to your WhatsApp account. Tars essentially acts as a Linked Device.

### Message Triggers

Unlike Discord where you might share a server with others, the WhatsApp connection is tied strictly to your number.

| Trigger            | Use Case         | Example                        |
| ------------------ | ---------------- | ------------------------------ |
| **Direct Message** | Private Commands | `Tell me the server status`    |
| **Voice Notes**    | _(Coming Soon)_  | Tars will transcribe & process |

### File Attachments

You can securely send files, images, and videos directly to Tars in WhatsApp. Tars will securely download the attachment, analyze its content, and include it in the conversation context. This is ideal for:

- Taking a picture of an error screen
- Sending PDF documents for summarization
- Sharing audio snippets

_Note: Uploaded files are automatically purged from the local cache to save storage space._

### Setup and Authentication

During `tars setup`, you will be prompted to enter your WhatsApp owner number (with country code). This acts as a security lock so Tars will **only respond to messages sent to/from this number**.

1. Start Tars by running `tars start`.
2. Look at the terminal output. Tars will generate a QR Code.
    - _If you are running Tars in the background via PM2, use `tars logs` to view the QR Code._
3. Open WhatsApp on your phone.
4. Go to **Settings > Linked Devices > Link a Device**.
5. Scan the QR code displayed in your terminal.

Once linked, Tars will maintain the session securely in `~/.tars/data/whatsapp-session` and auto-reconnect on restarts.

### Primary Channel Routing

Because Tars now supports both Discord and WhatsApp simultaneously, it implements **Last Active Routing**:

- Background tasks (like Cron alerts) will proactively send notifications to the **last channel you interacted on**.
- If Tars reboots and needs to send an alert before you interact, it will fall back to the **Primary Channel** you selected during `tars setup`.
