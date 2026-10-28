# Security policy

This project sits next to a phone system, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
**Security** tab → **Report a vulnerability**
(<https://github.com/dufoursim/shiftline/security/advisories/new>).

Include what you found, how to reproduce it, and its impact. You should get an answer within a week.

## Scope

In scope: the Worker (`src/`), the AMI gate (`server/ami-gate.py`, `server/ami-gate.service`) and
the setup instructions (`docs/`). Especially: any way to reach an AMI action, user, queue or
extension the gate should refuse, or to run a Slack command as someone else.

Out of scope: FreePBX, Asterisk, Cloudflare and Slack themselves (report to their vendors).

## Hardening reminders for operators

- Keep the four barriers: Slack signature, Cloudflare firewall rule, tunnel limited to `/rawman`,
  AMI gate. Never point the tunnel at Asterisk's port 8088 directly.
- Give the AMI user the `agent` and `user` rights only, and permit it from `127.0.0.1` only.
- Store secrets in Cloudflare (`wrangler secret put`) and a password manager, never in Git.
- Change `PBX_EDGE_KEY`, the AMI password and the Slack tokens when someone leaves the project.
