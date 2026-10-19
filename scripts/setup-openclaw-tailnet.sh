#!/usr/bin/env bash
# Safely prepare an existing OpenClaw Gateway for JARVIS over private Tailscale Serve.
# Run as the normal Linux account that owns the OpenClaw Gateway; never run as root.
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  echo "Do not run this script as root/sudo. Use the normal account that owns OpenClaw." >&2
  exit 1
fi
for command_name in openclaw tailscale; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

echo
echo "JARVIS ↔ OpenClaw private Tailnet setup"
echo "This helper will:"
echo "  • back up the current OpenClaw config"
echo "  • keep the Gateway bound to loopback"
echo "  • enable Tailscale Serve (private tailnet HTTPS)"
echo "  • enable OpenClaw's OpenAI-compatible Chat Completions endpoint"
echo
echo "It will NOT change the Gateway token/password, models, agents, tools, or workspace."
echo "It does not disable authentication or enable Tailscale Funnel/public access."
echo "The HTTP Chat Completions API uses an operator-level credential; only use this"
echo "with a trusted Tailnet and a server policy you are comfortable delegating to."
echo

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale is not connected for this account. Connect it first, then rerun." >&2
  exit 1
fi

if [[ ! -t 0 ]]; then
  echo "Run this helper in an interactive terminal so you can review and approve the changes." >&2
  exit 1
fi
read -r -p "Proceed with the private Tailscale setup? [y/N] " answer
case "$answer" in
  y|Y|yes|YES) ;;
  *) echo "No changes made."; exit 0 ;;
esac

config_file="$(openclaw config file)"
if [[ -z "$config_file" || ! -f "$config_file" || -L "$config_file" ]]; then
  echo "Could not safely identify a regular OpenClaw config file. No changes made." >&2
  exit 1
fi
backup_file="${config_file}.jarvis-backup-$(date +%Y%m%d-%H%M%S)"
cp -p -- "$config_file" "$backup_file"
echo "Config backup created: $backup_file"

patch_file="$(mktemp)"
cat > "$patch_file" <<'JSON'
{
  "gateway": {
    "bind": "loopback",
    "tailscale": {
      "mode": "serve"
    },
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
JSON

gateway_stopped=0
restore_needed=0
cleanup() {
  result=$?
  trap - EXIT
  if [[ "$gateway_stopped" -eq 1 ]]; then
    if [[ "$restore_needed" -eq 1 ]]; then
      echo "Setup failed before completion; restoring the original config backup." >&2
      cp -p -- "$backup_file" "$config_file" || echo "WARNING: automatic restore failed; backup is at $backup_file" >&2
      openclaw config validate || echo "WARNING: restored config needs inspection." >&2
    fi
    openclaw gateway start || echo "WARNING: Gateway did not restart automatically; check 'openclaw gateway status'." >&2
  fi
  rm -f -- "$patch_file"
  exit "$result"
}
trap cleanup EXIT

echo
echo "Stopping the local Gateway so its config can be updated safely…"
gateway_stopped=1
openclaw gateway stop
openclaw config patch --file "$patch_file" --dry-run
restore_needed=1
openclaw config patch --file "$patch_file"
openclaw config validate

echo "Configuration validated. Starting OpenClaw Gateway…"
openclaw gateway start
gateway_stopped=0
restore_needed=0
openclaw gateway status

echo
echo "Tailscale Serve status (copy the private HTTPS URL into JARVIS):"
tailscale serve status || true
echo
echo "Server setup complete. On your JARVIS computer, open System Console → OpenClaw,"
echo "paste the HTTPS Tailscale Serve URL ending in /v1 (or add /v1), and enter your"
echo "existing OpenClaw Gateway token or password. Do not send that secret in chat or GitHub."
echo "If HTTPS certificates are not enabled in your Tailnet, enable them in the Tailscale admin console first."
