# Agent guide

[Version française](GUIDE-AGENTS.fr.md)

For the people who take the calls. Share this page, or paste the [channel message](#message-to-pin-in-the-channel)
below into your announcement channel and pin it.

## Every shift

1. **Start of shift**: type `/online` in Slack. Calls from all your queues now ring at your extension.
   To join only one queue: `/online sales` (the words to type are set by your administrator).
2. **During the shift**: `/queues` shows each queue's waiting calls and who is online.
3. **Break, lunch, end of shift**: `/offline` (or `/offline sales` for one queue).

The bot announces every change in the announcement channel:
“🟢 Amélie Tremblay (ext. 201) is online — SALES”. If you type the command anywhere else
(direct message, another channel), you also get a private confirmation. Errors always come to you privately.

## States shown by `/queues`

| State | Meaning |
|---|---|
| 🟢 available | Logged in and free: the next call can ring |
| 📞 on a call | Logged in, already on a call |
| 🔔 ringing | A call is ringing right now |
| ⏸️ paused | Logged in but paused (calls do not ring) |
| ⚫ phone unreachable | Logged in, but the phone or softphone is not registered: **open your softphone** |

## Good to know

- **You can only manage your own extension.** Your Slack account is linked to it by your administrator.
- **Which queues can I join?** Only the ones your administrator gave you. `/online` with no word
  joins all of them; if you type a queue you are not part of, the bot tells you.
- **`*45` still works.** Logging in by phone or by Slack is the same thing: `/queues` sees both,
  and `/offline` logs you out even if you used `*45`.
- **A ⚠️ message means nothing changed.** Try again; if it fails again, check with `/queues` and
  tell your administrator.
- **“Not linked to any phone extension”**: ask your administrator to add you.

## Message to pin in the channel

Copy, adjust the queue words, paste in the announcement channel, then pin it
(message menu **⋮** → **Pin to channel**).

```
📞 *Taking calls with Shiftline*

• `/online` — start of shift: calls from all your queues ring at your extension
• `/online sales` or `/online support` — join only one queue
• `/offline` — break, lunch, end of shift (or `/offline sales`)
• `/queues` — who is online and how many calls are waiting

Every change is announced here. *45 on the phone still works and does the same thing.
⚫ "phone unreachable" in /queues = open your softphone!
A ⚠️ message means nothing changed: try again, then tell the administrator.
```

**Channel description** (channel name → **Edit description**):

```
Queue logins and logouts (/online, /offline). /queues shows who is taking calls.
```
