# JARVIS ↔ OpenClaw on a private Tailscale network

This optional integration lets JARVIS Next send approved complex tasks to a separately running OpenClaw agent. It does not replace JARVIS's local model or merge the two machines. This branch is chat-only and has no System Console or OpenClaw settings panel; configure the connection files manually as described in Step 2.

## What is included

- Out-of-band connection settings stored under ~/.local/share/jarvis/, outside the Git checkout.
- A Gateway token stored in a separate owner-only file; the browser never receives the saved secret.
- A connection test that calls OpenClaw's /v1/models endpoint.
- A `delegate_to_openclaw` tool that asks for approval in JARVIS before it sends a task.
- A guarded one-time helper for the OpenClaw server, plus regression tests for URL validation and secret storage.

The integration is deliberately opt-in. JARVIS does not automatically send all conversations to OpenClaw. An approved delegation is sent as a separate task, and the OpenClaw agent runs with the policy and tools configured on that server.

## Step 1 — Prepare the OpenClaw server

The server-side helper is `scripts/setup-openclaw-tailnet.sh`. Run it as the normal Linux user account that owns the OpenClaw Gateway, **not with sudo**. Get the JARVIS ZIP on the server too, or copy just this script to the server.

From the extracted JARVIS folder, run:

```bash
bash scripts/setup-openclaw-tailnet.sh
```

It checks that both `openclaw` and `tailscale` commands are available and that Tailscale is connected. It asks for confirmation, makes a timestamped copy of the active OpenClaw config, stops the Gateway while applying a small validated config patch, and starts it again. The patch only:

- keeps the Gateway bound to loopback;
- enables Tailscale Serve (HTTPS that is private to your Tailnet);
- enables the OpenAI-compatible Chat Completions endpoint required by JARVIS.

It does **not** change Gateway authentication, models, agents, workspace, or agent tools. It does not enable Tailscale Funnel or disable authentication. The helper attempts to restore the config backup if the patch/validation fails. Keep the printed backup path until you have tested the connection.

Tailscale Serve needs HTTPS certificates enabled for your Tailnet in the Tailscale admin console. The helper prints `tailscale serve status` at the end. Copy the private HTTPS `.ts.net` address from that output; JARVIS will add `/v1` automatically. A direct `http://100.x.y.z:18789` Tailscale IP is also supported if you prefer that and the OpenClaw Gateway port is reachable on the Tailnet.

If OpenClaw is configured for `gateway.auth.mode: "none"` or a trusted-proxy-only setup, stop rather than disabling security or guessing at credentials. This integration sends a Bearer Gateway token; it does not support the Gateway password as a Basic-auth substitute. Review the active OpenClaw configuration and its official auth guidance first.

Official references:
- [OpenClaw Chat Completions API](https://docs.openclaw.ai/gateway/openai-http-api)
- [OpenClaw stable HTTPS URL / Tailscale Serve](https://docs.openclaw.ai/gateway/stable-https-url)
- [OpenClaw config CLI](https://docs.openclaw.ai/cli/config)

## Step 2 — Configure JARVIS Next (chat-only branch)

This branch has no System Console or settings UI. Configure the connection on the same Linux account that runs JARVIS.

The private base URL and agent target are stored in the file ~/.local/share/jarvis/openclaw.json. The token is stored separately in ~/.local/share/jarvis/openclaw-secret.json. Never commit either file.

Create the private directory and edit the non-secret configuration:

    install -d -m 700 ~/.local/share/jarvis
    umask 077
    nano ~/.local/share/jarvis/openclaw.json

Enter the following JSON, substituting the private .ts.net hostname reported by tailscale serve status:

    {
      "base_url": "https://your-server.your-tailnet.ts.net/v1",
      "model": "openclaw/default"
    }

The model must be a valid agent target such as openclaw/default or an existing target using the supported openclaw/, openclaw:, or agent: prefix. Use only a private Tailscale Serve HTTPS hostname or an allowed Tailscale IP URL. The URL may include /v1; JARVIS normalizes it.

Create the secret file without putting the token in a shell command or commit:

    umask 077
    nano ~/.local/share/jarvis/openclaw-secret.json
    chmod 600 ~/.local/share/jarvis/openclaw.json ~/.local/share/jarvis/openclaw-secret.json

Enter the existing Gateway token in this format:

    {"token": "PASTE_THE_EXISTING_GATEWAY_TOKEN_HERE"}

Replace the placeholder inside the editor with the actual token. Do not paste the token into chat, an issue, a commit, or a screenshot.

After saving, restart JARVIS and test delegation with a substantial but harmless task. JARVIS asks for approval before delegation. This branch does not have an in-app connection test, so use server logs and the OpenClaw API response to troubleshoot.

## Security note: this is a powerful credential

OpenClaw documents its Chat Completions endpoint as an operator-level surface: a valid Gateway token is not a limited per-app token. Calls run through the selected agent's normal tools and policies. Keep this endpoint private to your Tailnet, do not expose it to the public internet, and configure the OpenClaw agent's server-side tools/permissions conservatively. The JARVIS approval dialog is an additional confirmation before the task is sent, but it cannot limit what an OpenClaw agent is allowed to do once a task is approved.

## Current limitations

- Delegated work is a single non-streaming request with a two-hour network read timeout to accommodate long coding jobs. The JARVIS chat waits for OpenClaw's final response; live progress and an in-app cancellation button are not implemented yet. The JARVIS backend keeps the upstream request open even if you close the browser tab, so wait for the final result or restart JARVIS to break its connection.
- The connection test checks reachability, authentication, and available agent targets. It does not guarantee that the selected agent's model provider or every remote tool is healthy.
- JARVIS sends the explicit task text (and a generated session identifier) to OpenClaw. It does not forward the full JARVIS transcript, attached images, or saved JARVIS memories.
- If the Gateway token is rotated, update ~/.local/share/jarvis/openclaw-secret.json with the new token, keep permissions at 0600, then restart JARVIS.
