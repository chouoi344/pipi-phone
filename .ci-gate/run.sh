#!/usr/bin/env bash
set -euo pipefail
# The shipped worker must read the UID 1000, mode 0600 update request. Android
# uses the runner's already-started adb server rather than opening another one.
sudo --preserve-env=GATE_OLD_IMAGE,GATE_NEXT_IMAGE,GATE_CLIENT,GATE_EVIDENCE_DIR,GATE_APK_PATH,PIPI_PLAYWRIGHT_MODULE,PIPI_BROWSER_EXECUTABLE,GITHUB_RUN_ID,GITHUB_RUN_ATTEMPT,ADB_PATH,ADB_SERVER_SOCKET \
  "$(command -v node)" .ci-gate/upgrade.cjs
