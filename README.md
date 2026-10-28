# Shiftline

**Let your call-center agents log in and out of FreePBX queues from Slack, with no open ports on your PBX.**

[Version française](README.fr.md) · [Server setup](docs/SERVER-SETUP.md) · [Agent guide](docs/AGENT-GUIDE.md) · [Operations](docs/OPERATIONS.md) · [Security](SECURITY.md) · MIT license

```
/online           🟢 Amélie Tremblay (ext. 201) is online — SALES, SUPPORT
/offline sales    🔴 Amélie Tremblay (ext. 201) is offline — SALES
/queues           SALES (1000) — ⏳ 2 calls waiting
                     • Amélie Tremblay (201) — 🟢 available
                     • Jordan Smith (202) — 📞 on a call
```

Agents forget to dial `*45`, or cannot dial it from a softphone while working from home. This bot puts
queue login where your team already is: Slack. Every change is announced in a channel, so everybody
knows who is taking calls.

## Features

- **`/online`**, **`/offline`**: log into (or out of) all your queues, or just one (`/online sales`).
- **`/queues`**: calls waiting in each queue, and who is online with their live state
  (available, on a call, ringing, paused, phone unreachable).
- **Announcements** in a channel of your choice; errors are always reported privately.
- **Same behaviour as `*45`**: agents logged in by phone show up in Slack, and the other way round.
- **Each person manages only their own extension**: Slack accounts are mapped to extensions.
- **English or French** messages (`LANGUAGE = "en"` or `"fr"`).
- **Serverless**: a single Cloudflare Worker (free plan is enough), no database.

## Security first

The Asterisk Manager Interface (AMI) is powerful: an AMI account can place calls or run commands.
This project never exposes it. A request has to pass **four barriers**:

```
Slack ──signed──▶ Cloudflare Worker ──X-Edge-Key──▶ Cloudflare WAF rule
                                                      │ (blocks everything without the key)
                                                      ▼
                                   Cloudflare Tunnel (only /rawman, no open port)
                                                      ▼
                     AMI gate on the PBX, 127.0.0.1:8090 (server/ami-gate.py)
                     one AMI user, 6 actions, your queues and extensions only
                                                      ▼
                     Asterisk, 127.0.0.1:8088 — AMI user with "agent" + "user" rights only
```

1. **Slack signature**: every command is checked (HMAC-SHA256, 5-minute replay window).
2. **Cloudflare firewall rule**: the tunnel hostname answers `403` to anything without the Worker's key.
3. **Cloudflare Tunnel**: outbound-only connection from the PBX; only the `/rawman` path is forwarded.
4. **AMI gate**: a small Python program (standard library only, ~200 lines, easy to audit) that
   checks the key again and accepts only one AMI user, the `Login`, `Logoff`, `QueueAdd`,
   `QueueRemove`, `QueueStatus` and `UserEvent` actions with their allowed parameters, and your
   queues and extensions. It refuses anything ambiguous (repeated or unknown parameters, control
   characters) and rebuilds the request it forwards. It runs as a sandboxed systemd service.

Without the gate, every AMI account (including FreePBX's internal, all-powerful one) would be
reachable through the tunnel, because tunnel traffic reaches Asterisk "from 127.0.0.1".

## Requirements

- **FreePBX 17** (Asterisk 20+), tested on FreePBX 17.0.33 / Asterisk 22 / Debian 12, with SSH and `sudo`.
- Queues whose agents are **dynamic agents**.
- A **Slack** workspace where you can install an app.
- A **Cloudflare** account with a domain on Cloudflare (for the tunnel hostname).
- **Node.js 18+** and **Git** on your computer.
- A **password manager** for the secrets (see [the list](docs/OPERATIONS.md#values-to-keep-in-your-password-manager)).

## Quick start

About two hours the first time. Do the steps in order: each one needs the previous one. Write the
values down in your password manager as you go.

**1. Get the code**

```bash
git clone https://github.com/dufoursim/shiftline.git
```

```bash
cd shiftline && npm install && npm test
```

```bash
cp wrangler.example.toml wrangler.toml
```

Edit `wrangler.toml`: `AMI_URL` (your tunnel hostname), `LANGUAGE`, `QUEUES`, and `AGENTS` (name,
extension, queues; leave `slack` empty for now).

**2. Deploy the Worker**

```bash
npx wrangler login
```

```bash
npm run deploy
```

Note the Worker address, e.g. `https://shiftline.YOUR-SUBDOMAIN.workers.dev`.

**3. Create the Slack app**

Open [`slack-manifest.json`](slack-manifest.json), replace `YOUR-SUBDOMAIN` (3 times) and the bot
name. Then <https://api.slack.com/apps> → **Create New App** → **From a manifest** → paste →
**Create** → **Install to Workspace**. Copy the **Bot User OAuth Token** (`xoxb-…`) and, under
**Basic Information** → **App Credentials**, the **Signing Secret**. ⚠️ Not the *Client Secret*, the
*Verification Token* or an *App-Level Token* (`xapp-…`): Shiftline does not use them.

In Slack, create the announcement channel, add the bot to it (channel name → **Integrations** →
**Add apps**), and copy its **Channel ID** into `ANNOUNCE_CHANNEL`. For each agent, copy their
**member ID** (profile → **⋮** → **Copy member ID**) into `slack` in `AGENTS`.

**4. Prepare FreePBX** (web interface)

- **Applications → Queues** → each queue → **Queue Agents**: each agent's extension is in
  **Dynamic Agents** as `EXTENSION,PENALTY` (e.g. `201,0`). **Submit**, **Apply Config**.
- **Settings → Asterisk Manager Users → Add Manager**:

  | Field | Value |
  |---|---|
  | Manager name | `shiftline` |
  | Manager secret | about 24 random **letters and digits** (the gate refuses other characters) |
  | Deny | `0.0.0.0/0.0.0.0` |
  | Permit | `127.0.0.1/255.255.255.255` |
  | Write Timeout | `100` |
  | Rights | **only** `agent` (Read + Write) and `user` (Write, for the `UserEvent`s that `*45` also sends) |

  **Submit**, **Apply Config**.

**5. Protect the hostname** (before the tunnel exists)

Make up a random key of about 40 letters and digits (`PBX_EDGE_KEY`). Cloudflare → your domain →
**Security** → **Security rules** → **Create rule** → **Custom rule**, action **Block**:

```
(http.host eq "pbx-api.example.com" and not any(http.request.headers["x-edge-key"][*] eq "YOUR_KEY"))
```

**6. Set up the PBX**

Follow **[docs/SERVER-SETUP.md](docs/SERVER-SETUP.md)**: enable AMI over HTTP, install the AMI gate,
create the Cloudflare Tunnel.

**7. Store the secrets and redeploy**

```bash
npx wrangler secret put SLACK_BOT_TOKEN
```

```bash
npx wrangler secret put SLACK_SIGNING_SECRET
```

```bash
npx wrangler secret put AMI_USERNAME
```

```bash
npx wrangler secret put AMI_SECRET
```

```bash
npx wrangler secret put PBX_EDGE_KEY
```

```bash
npm run deploy
```

**8. Test**

| # | Do | Expected |
|---|---|---|
| 1 | `curl -s -o /dev/null -w "%{http_code}\n" "https://pbx-api.example.com/rawman?action=Ping"` | `403` (blocked without the key) |
| 2 | In Slack: `/queues` | Your queues, “no calls waiting”, “Nobody online” (or the logged-in agents) |
| 3 | `/online sales` | 🟢 announcement in the channel (and a private confirmation if typed elsewhere) |
| 4 | `/queues` | You are listed under the queue, “available” |
| 5 | `/offline sales` | 🔴 announcement |
| 6 | Dial `*45` on your phone, then `/queues`, then `/offline` | You show up as logged in, then out: `*45` and Shiftline agree |

If something fails: [Troubleshooting](#troubleshooting), and `npx wrangler tail` for the exact error.

**9. Finish**: go through the [after-installation checklist](docs/OPERATIONS.md#after-installation-checklist)
and share the [agent guide](docs/AGENT-GUIDE.md) with your team.

## Configuration

| Name | Where | What |
|---|---|---|
| `AMI_URL` | `wrangler.toml` | Tunnel address, e.g. `https://pbx-api.example.com` |
| `ANNOUNCE_CHANNEL` | `wrangler.toml` | Slack channel ID for announcements (`""` for none) |
| `LANGUAGE` | `wrangler.toml` | `en` (default) or `fr` |
| `QUEUES` | `wrangler.toml` | `"1000" = { name = "SALES", alias = "sales" }` |
| `AGENTS` | `wrangler.toml` | `{ name, extension, slack, queues = ["1000"] }` |
| `SLACK_BOT_TOKEN` | secret | Bot token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | secret | Slack app signing secret |
| `AMI_USERNAME`, `AMI_SECRET` | secret | The restricted AMI user |
| `PBX_EDGE_KEY` | secret | Same key as the firewall rule and `/etc/ami-gate/edge-key` |

The status command answers to both `/queues` and `/file` (its name in the French setup).

## How it works

1. Slack sends the command to `POST /slack/commands`. The Worker checks the signature, finds the
   agent by Slack ID, answers Slack immediately (3-second limit), then works in the background.
2. It calls `AMI_URL/rawman`: `Login`, the actions, `Logoff`.
3. The actions mirror FreePBX's `*45` (`macro-toggle-add-agent` / `macro-toggle-del-agent`):
   `QueueAdd` with `Local/EXT@from-queue/n` and `hint:EXT@ext-local`, then `UserEvent AgentLogin`;
   `QueueRemove` of both `from-queue` and `from-internal` formats, then `UserEvent RefreshQueue`.
   Only difference: queue BLF lamps (`DEVICE_STATE(Custom:QUEUE…)`) are not updated, because that
   would need the much broader AMI `call` right.
4. The result goes back privately through Slack's `response_url`, and the announcement through
   `chat.postMessage`.

## FAQ

**Why the Asterisk AMI and not the FreePBX REST/GraphQL API?** The FreePBX API is meant for
*configuration* (creating queues, extensions…); it does not log agents in and out live. The AMI
actions `QueueAdd` / `QueueRemove` are what FreePBX's own `*45` uses, and `QueueStatus` gives the
live picture. Asterisk's ARI drives calls, not queue members, so it does not fit either.

**Will FreePBX and Asterisk get out of sync?** No: Shiftline writes exactly what `*45` writes
(same member interface, same state interface, same `UserEvent`s, both logout formats). An agent
logged in by phone can log out from Slack and the other way round. Only the queue BLF lamps
(`DEVICE_STATE(Custom:QUEUE…)`) are not updated; if your phones use them, they may show the wrong
state after a Slack login.

**Does it need a paid Cloudflare plan?** No. The Worker, the tunnel and one custom firewall rule
fit in the free plan.

**Can agents log other people in or out?** No. Each Slack account is linked to one extension,
and the gate on the server only accepts the extensions you list.

**What if Cloudflare or Slack is down?** `*45` keeps working: Shiftline only adds a way to log in,
it does not replace the phone's.

## Development

```bash
npm test
```

```bash
npm run test:gate
```

`npm test` runs the Worker tests (Slack and FreePBX are simulated); `npm run test:gate` runs the
gate tests (what it refuses, and a round trip through a fake Asterisk). `npx wrangler tail` shows
live logs of the deployed Worker.

## Troubleshooting

| You see | Likely cause | Fix |
|---|---|---|
| ⚠️ … HTTP 403 | Key differs between the Worker, the firewall rule and the gate, or an extension/queue is missing from `GATE_EXTENSIONS` / `GATE_QUEUES` | `sudo journalctl -u ami-gate -n 50` tells which |
| ⚠️ … HTTP 404 | Wrong path: `AMI_URL`, the tunnel `path:`, or Asterisk's HTTP prefix missing from `GATE_UPSTREAM` | `sudo asterisk -rx "http show status"` |
| ⚠️ … HTTP 502 / 530 | Tunnel or gate stopped | `sudo systemctl status cloudflared ami-gate` |
| ⚠️ AMI login refused | `AMI_SECRET` differs from FreePBX | Set the same password in both places |
| “not linked to any phone extension” | Slack ID missing from `AGENTS` | Add it and redeploy |
| No announcement | Bot not in the channel (`not_in_channel` in `wrangler tail`) | Add the app to the channel |
| `dispatch_failed` in Slack | Wrong Request URL in the slash command | api.slack.com → **Slash Commands** |

## Files

- `src/index.js`: Slack commands, signature check, replies and announcements
- `src/queues.js`: configuration, agents, login/logout, queue status
- `src/ami.js`: AMI client over HTTP (`rawman`)
- `src/messages.js`: bot texts in English and French
- `server/ami-gate.py`, `server/ami-gate.service`: the AMI gate for the PBX
- `test/`: Worker tests (`index.test.js`) and gate tests (`test_gate.py`)
- `wrangler.example.toml`, `slack-manifest.json`: templates to copy
- `docs/SERVER-SETUP.md`: exact commands on the PBX
- `docs/AGENT-GUIDE.md`: for the agents, with a message to pin in the channel
- `docs/OPERATIONS.md`: add agents and queues, secrets, handover
- Each guide also exists in French (`*.fr.md`)

## Support the project

Shiftline is free and maintained on spare time. If it saves your team time, you can support its
development with [GitHub Sponsors](https://github.com/sponsors/dufoursim) (the **❤️ Sponsor**
button at the top of this page). Stars, bug reports and pull requests help too.

## License

[MIT](LICENSE) © 2026 Simon Dufour. Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
