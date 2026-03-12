#!/bin/bash
export GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/home/stark/.tars/.gemini/google-workspace-creds.json
# Expose Gmail, Calendar, Drive, Sheets, Docs, Tasks, and People (Contacts)
/home/stark/.tars/apps/tars/extensions/google-workspace/node_modules/.bin/gws mcp -s gmail,calendar,drive,sheets,docs,tasks,people --tool-mode compact
