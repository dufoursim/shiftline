# Operations guide

[Version française](EXPLOITATION.fr.md)

For the administrator, once Shiftline is installed. Run the `npx wrangler` / `npm` commands in the
project folder, after `npm install` and `npx wrangler login` (with the Cloudflare account that owns
the Worker).

## Add or remove an agent

An agent needs **three** things, in this order:

1. **FreePBX** → **Applications → Queues** → each queue → **Queue Agents** → **Dynamic Agents**:
   add the extension as `EXTENSION,PENALTY`, e.g. `201,0` → **Submit** → **Apply Config**.
   (If *Restrict Dynamic Agents* is Yes, only extensions listed here may log in, by `*45` or by Slack.)
2. **Server** → the extension in `GATE_EXTENSIONS` of `/etc/systemd/system/ami-gate.service`, then:

   ```bash
   sudo systemctl daemon-reload && sudo systemctl restart ami-gate
   ```

3. **`wrangler.toml`** → a line in `AGENTS`:
   `{ name = "First Last", extension = "201", slack = "U0…", queues = ["1000"] }`
   (Slack ID: their profile → **⋮** → **Copy member ID**), then:

   ```bash
   npm test && npm run deploy
   ```

To remove someone: delete their `AGENTS` line and deploy, remove the extension from
`GATE_EXTENSIONS`, and from the queue's Dynamic Agents. Add them to (or remove them from) the
announcement channel too.

## Add a queue

1. FreePBX: the queue exists, with its Dynamic Agents.
2. Server: its number in `GATE_QUEUES` of the gate service, then restart the gate (as above).
3. `wrangler.toml`: `"1002" = { name = "BILLING", alias = "billing" }` in `[vars.QUEUES]`, and
   `"1002"` in the `queues` of the agents concerned. Update the `usage_hint` of `/online` and
   `/offline` in the Slack app (**Slash Commands**). Deploy.

## Everyday commands

| I want to… | Command |
|---|---|
| See what the Worker does, live | `npx wrangler tail` |
| Put a change online | `npm test`, then `npm run deploy` |
| Go back to a previous version | `npx wrangler rollback` |
| List the secrets (names only) | `npx wrangler secret list` |
| Change a secret | `npx wrangler secret put NAME` |
| See what the gate accepts and refuses | `sudo journalctl -u ami-gate -n 50 --no-pager` |
| Check the tunnel | `sudo systemctl status cloudflared --no-pager` |
| Cut Shiftline's access to the PBX at once | `sudo systemctl stop cloudflared` |

## Secrets: where they live and how to change them

Cloudflare never shows a secret again: you **replace** it (`npx wrangler secret put NAME`, or
Worker → **Settings** → **Variables and Secrets**). It takes effect immediately.

| Secret | What | How to change it | Also stored in |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-…`) | api.slack.com → your app → **OAuth & Permissions** → **Revoke All OAuth Tokens**, **Install to Workspace**, copy the new one | — |
| `SLACK_SIGNING_SECRET` | Proves commands come from Slack | **Basic Information** → **App Credentials** → **Regenerate** | — |
| `AMI_USERNAME` | AMI user name | FreePBX → **Settings → Asterisk Manager Users** | FreePBX, and `GATE_AMI_USER` of the gate |
| `AMI_SECRET` | AMI user password (letters and digits only) | Change **Manager secret** in FreePBX (**Submit**, **Apply Config**), then here | FreePBX |
| `PBX_EDGE_KEY` | Key in the `X-Edge-Key` header | Make up a new one (40 letters and digits) | Cloudflare firewall rule **and** `/etc/ami-gate/edge-key` (then `sudo systemctl restart ami-gate`): change all three together |

Not Worker secrets, but to protect as well:

- **Tunnel credentials**: `/etc/cloudflared/TUNNEL_ID.json` on the server (root only). Revoke with
  `cloudflared tunnel delete shiftline`.
- **SSH access** to the server: if it uses a certificate, note its **expiry date**.

## Values to keep in your password manager

| Value | Secret? |
|---|---|
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Yes |
| `AMI_SECRET`, `PBX_EDGE_KEY` | Yes |
| Worker address, Slack app ID, announcement channel ID, tunnel ID and hostname | No, but handy |

Never send secrets by email or Slack.

## Handover checklist

A new administrator needs access to:

- [ ] **GitHub**: your copy of the repository (with your real `wrangler.toml` kept somewhere safe,
      since it is not in Git)
- [ ] **Cloudflare**: the account with the Worker and the domain
- [ ] **Slack**: the app (**Collaborators** on api.slack.com) and the announcement channel
- [ ] **FreePBX**: web administration
- [ ] **Server**: SSH with `sudo`

When someone leaves the project, **change the secrets** above.

## After installation checklist

- [ ] The values are in your password manager.
- [ ] Your real `wrangler.toml` is backed up (it is ignored by Git).
- [ ] The [channel message](AGENT-GUIDE.md#message-to-pin-in-the-channel) is posted and pinned,
      and the channel has a description.
- [ ] The agents are in the announcement channel and have the [agent guide](AGENT-GUIDE.md).
- [ ] The SSH certificate expiry date (if any) is in your calendar.
