# Changelog

## 1.0.0 — 2026-10-28

First public release.

- `/online`, `/offline` (all queues or one) and `/queues` (alias `/file`) Slack commands.
- Same queue membership format as FreePBX's `*45` feature code, both ways.
- Announcements in a Slack channel; errors always reported privately.
- English and French messages (`LANGUAGE`).
- AMI gate (`server/ami-gate.py`): one AMI user, six actions, allowed queues and extensions only,
  sandboxed systemd service.
- Guides in English and French: server setup, agent guide (with a message to pin), operations.
