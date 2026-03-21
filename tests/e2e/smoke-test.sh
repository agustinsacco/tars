#!/bin/bash
# TARS E2E Smoke Test
# This script verifies that the Tars CLI can manage an instance lifecycle.

set -e

# Setup temporary environment
TEST_HOME=$(mktemp -d)
export TARS_HOME="$TEST_HOME"
export TARS_INSTANCE_NAME="tars-smoke-test"
TARS_BIN="node $(pwd)/dist/cli/index.js"

echo "🧪 Starting TARS Smoke Test..."
echo "📂 TARS_HOME: $TARS_HOME"

# 1. Initialize dummy config
mkdir -p "$TARS_HOME/.gemini"
mkdir -p "$TARS_HOME/data"

cat <<EOF > "$TARS_HOME/config.json"
{
  "assistantName": "SmokeTestBot",
  "geminiModel": "auto",
  "heartbeatIntervalSec": 10
}
EOF

cat <<EOF > "$TARS_HOME/.env"
DASH_ENABLED=false
DISCORD_TOKEN=mock_token
GEMINI_API_KEY=AIzaSy_mock_key
EOF

# 2. Check initial status
echo "🔍 Checking initial status..."
$TARS_BIN status | grep -q "not running"
echo "  ✓ Correctly reported as not running."

# 3. Start Tars
echo "🚀 Starting Tars instance..."
$TARS_BIN start --name "$TARS_INSTANCE_NAME" --role "CI Testing"

# 4. Wait for initialization
echo "⏳ Waiting for PM2 to bring process online..."
sleep 5

# 5. Check status again
echo "📊 Checking status while running..."
STATUS_OUT=$($TARS_BIN status)
echo "$STATUS_OUT" | grep -q "online"
echo "  ✓ Status reports online."

# 6. Check logs (first few lines)
echo "📜 Verifying log access..."
$TARS_BIN logs --help > /dev/null # Just checking command exists
echo "  ✓ Logs command accessible."

# 7. Stop Tars
echo "🛑 Stopping Tars instance..."
$TARS_BIN stop

# 8. Final status check
echo "🔍 Checking final status..."
$TARS_BIN status | grep -q "not running"
echo "  ✓ Correctly reported as stopped."

# Cleanup
rm -rf "$TEST_HOME"

echo "✨ Smoke test PASSED!"
