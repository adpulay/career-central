#!/usr/bin/env bash
# One recurring-monitor tick for an external trigger (Windows Task Scheduler via
# wsl.exe, or cron). Installing a trigger is a separate, user-approved step; this
# script does nothing unless a recurring authorization exists in the data root.
# Output: one JSON line per run appended to <data root>/data/logs/job-monitor-tick.log
# (source IDs, counts and sanitized categories only), rotated at 5 MiB.
set -uo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo" || exit 1
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi
node_bin="${NODE_BIN:-$(command -v node)}"
[ -n "$node_bin" ] || { echo "node not found" >&2; exit 1; }
log_dir="${CAREER_OPS_ROOT:-$repo}/data/logs"
mkdir -p "$log_dir" && chmod 700 "$log_dir"
log="$log_dir/job-monitor-tick.log"
if [ -f "$log" ] && [ "$(stat -c %s "$log")" -gt 5242880 ]; then mv -f "$log" "$log.1"; fi
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
output="$("$node_bin" scripts/job-monitor.mjs tick --authorize-live-read 2>&1)"; status=$?
printf '{"at":"%s","exit":%d,"result":%s}\n' "$started" "$status" "$(printf '%s' "$output" | tr -d '\n' | sed 's/^$/null/')" >> "$log"
chmod 600 "$log"
exit "$status"
