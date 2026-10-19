# JARVIS ↔ OpenClaw on a private Tailscale network

This optional integration lets JARVIS on your laptop ask a separately running OpenClaw agent to handle a task. JARVIS keeps its current dashboard, local model, and voice. It does not replace the JARVIS model or merge the two machines.

## What is included

- A new **System Console → OpenClaw** setup panel.
- Local server-side storage for the Gateway token/password, with owner-only file permissions; the browser never receives the saved secret.
- A connection test that calls OpenClaw's `/v1/models` endpoint.
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

It does **not** change the Gateway token/password, models, agents, workspace, or agent tools. It does not enable Tailscale Funnel or disable authentication. The helper attempts to restore the config backup if the patch/validation fails. Keep the printed backup path until you have tested the connection.

Tailscale Serve needs HTTPS certificates enabled for your Tailnet in the Tailscale admin console. The helper prints `tailscale serve status` at the end. Copy the private HTTPS `.ts.net` address from that output; JARVIS will add `/v1` automatically. A direct `http://100.x.y.z:18789` Tailscale IP is also supported if you prefer that and the OpenClaw Gateway port is reachable on the Tailnet.

If OpenClaw is configured for `gateway.auth.mode: "none"` or a trusted-proxy-only setup, stop rather than disabling security or guessing at credentials. This first version expects standard Gateway token or password authentication. Review the active OpenClaw configuration and its official auth guidance first.

Official references:
- [OpenClaw Chat Completions API](https://docs.openclaw.ai/gateway/openai-http-api)
- [OpenClaw stable HTTPS URL / Tailscale Serve](https://docs.openclaw.ai/gateway/stable-https-url)
- [OpenClaw config CLI](https://docs.openclaw.ai/cli/config)

## Step 2 — Configure JARVIS on your laptop

1. Start JARVIS as usual and open **System Console → OpenClaw**.
2. Paste the server's private Tailscale HTTPS URL from `tailscale serve status`. It may look like `https://server-name.your-tailnet.ts.net`. You can paste it with or without `/v1`.
3. Leave the agent target as `openclaw/default` to use OpenClaw's default agent, or enter a target listed by the connection test (for example, `openclaw/coder` if that agent actually exists).
4. Enter the existing OpenClaw **Gateway token** when the server uses token auth, or the existing Gateway **password** when it uses password auth. This is not your Linux password and not necessarily the Control UI's separate device-pairing credential.
5. Click **Save & test connection**. A successful test means JARVIS can authenticate and retrieve the agent list. It does not run a task yet.

The token/password is stored in `~/.local/share/jarvis/openclaw-secret.json` with mode `0600`; the non-secret URL and agent target live in `openclaw.json` beside it. These files are outside the Git checkout and are not committed to GitHub. You may leave the password box blank later to retain the saved credential. **Never paste the token into chat, an issue, a commit, or a shared screenshot.**

Use **Disconnect** in the panel to remove the saved connection URL and secret from this laptop.

## Security note: this is a powerful credential

OpenClaw documents its Chat Completions endpoint as an operator-level surface: a valid Gateway token/password is not a limited per-app token. Calls run through the selected agent's normal tools and policies. Keep this endpoint private to your Tailnet, do not expose it to the public internet, and configure the OpenClaw agent's server-side tools/permissions conservatively. The JARVIS approval dialog is an additional confirmation before the task is sent, but it cannot limit what an OpenClaw agent is allowed to do once a task is approved.

## Current limitations

- Delegated work is a single non-streaming request. The JARVIS chat waits for OpenClaw's final response; live progress and cancellation controls are not implemented yet.
- The connection test checks reachability, authentication, and available agent targets. It does not guarantee that the selected agent's model provider or every remote tool is healthy.
- JARVIS sends the explicit task text (and a generated session identifier) to OpenClaw. It does not forward the full JARVIS transcript, attached images, or saved JARVIS memories.
- If the Gateway token is rotated, enter the new token in the JARVIS panel and save again.
