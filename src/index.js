/**
 * Cloudflare Worker: FreePBX queue agents log in and out from Slack.
 *
 *   /online [queue]   log in to your queues (all of them, or one: "sales", "support"…)
 *   /offline [queue]  log out
 *   /queues           see who is online and how many calls are waiting
 *                     (also answers to /file, its name in the French setup)
 *
 * Each Slack account is linked to one extension (AGENTS in wrangler.toml): people can only log
 * their own extension in or out. Changes are announced in ANNOUNCE_CHANNEL.
 *
 * Secrets (Cloudflare): SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, AMI_USERNAME, AMI_SECRET, PBX_EDGE_KEY.
 * Variables (wrangler.toml): AMI_URL, ANNOUNCE_CHANNEL, LANGUAGE, QUEUES, AGENTS.
 */
import { messages } from "./messages.js";
import { agentForSlackUser, getConfig, login, logout, memberState, queueLabel, queueStatus, selectQueues } from "./queues.js";

const encoder = new TextEncoder();

// Checks that the request really comes from Slack (HMAC-SHA256 signature of the body).
// See https://api.slack.com/authentication/verifying-requests-from-slack
export async function verifySlackSignature(request, rawBody, secret, now = Date.now()) {
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature") || "";
  // Reject requests older than 5 minutes (replay protection).
  if (!timestamp || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${rawBody}`));
  const expected = "v0=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Constant-time comparison, so timing gives no hint about the right signature.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// Posts a message in a Slack channel (as the bot). Returns true when Slack accepted it.
async function postMessage(env, channel, text) {
  if (!channel) return false;
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify({ channel, text }),
  });
  const data = await res.json().catch(() => ({}));
  // Shown by "npx wrangler tail" (e.g. not_in_channel, channel_not_found).
  if (!data.ok) console.error(`Slack chat.postMessage: ${data.error}`);
  return data.ok === true;
}

// Replies privately to the person, through the reply address Slack provides (response_url).
function respond(responseUrl, text) {
  return fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ response_type: "ephemeral", text }),
  });
}

const ephemeral = (text) => Response.json({ response_type: "ephemeral", text });

// /online and /offline: logs the person who typed the command in or out.
function loginCommand(form, env, ctx, online) {
  const t = messages(env);
  const config = getConfig(env);
  const agent = agentForSlackUser(config, form.get("user_id"));
  if (!agent) return ephemeral(t.notLinked);
  const selection = selectQueues(config, agent, form.get("text"), t);
  if (selection.error) return ephemeral(`:warning: ${selection.error}`);

  // Slack wants an answer within 3 seconds: FreePBX is called after answering.
  ctx.waitUntil(
    (async () => {
      try {
        const result = await (online ? login : logout)(env, agent, selection.queues);
        const names = result.ok.map((q) => queueLabel(config, q)).join(", ");
        const lines = [];
        if (result.ok.length) {
          const announced = await postMessage(
            env,
            env.ANNOUNCE_CHANNEL,
            online ? t.announceOnline(agent, names) : t.announceOffline(agent, names),
          );
          // Typed in the announcement channel: the announcement is enough, no duplicate private confirmation.
          if (!(announced && form.get("channel_id") === env.ANNOUNCE_CHANNEL)) {
            lines.push(online ? t.confirmOnline(names, result.ok.length, agent.extension) : t.confirmOffline(names));
          }
        }
        for (const f of result.failed) {
          lines.push(`:warning: ${queueLabel(config, f.queue)}: ${f.message}`);
        }
        // Errors are always reported privately.
        if (lines.length) await respond(form.get("response_url"), lines.join("\n"));
      } catch (err) {
        console.error(`${online ? "/online" : "/offline"}: ${err.message}`);
        await respond(form.get("response_url"), t.pbxUnreachable(err.message));
      }
    })(),
  );
  // Empty answer: Slack shows nothing, the result arrives on its own (one message per command).
  return new Response("");
}

// /queues text: for each queue, the waiting calls and the logged-in agents.
export function buildStatusText(config, status, t = messages({})) {
  const blocks = Object.keys(config.queues).map((id) => {
    const q = status[id] ?? { waiting: 0, members: [] };
    const members = q.members.length
      ? q.members.map((m) => `   • ${m.name}${m.extension ? ` (${m.extension})` : ""} — ${memberState(m, t)}`).join("\n")
      : `   ${t.nobodyOnline}`;
    const waiting = q.waiting ? t.waiting(q.waiting) : t.noneWaiting;
    return `*${queueLabel(config, id)}* (${id}) — ${waiting}\n${members}`;
  });
  return [t.statusTitle, "", ...blocks].join("\n");
}

function statusCommand(form, env, ctx) {
  const t = messages(env);
  const config = getConfig(env);
  ctx.waitUntil(
    (async () => {
      try {
        await respond(form.get("response_url"), buildStatusText(config, await queueStatus(env, config), t));
      } catch (err) {
        console.error(`${form.get("command")}: ${err.message}`);
        await respond(form.get("response_url"), t.statusUnreachable(err.message));
      }
    })(),
  );
  return new Response("");
}

// Receives the Slack commands (sent to /slack/commands) and routes them by name.
async function handleSlashCommand(request, env, ctx) {
  const raw = await request.text();
  if (!env.SLACK_SIGNING_SECRET || !(await verifySlackSignature(request, raw, env.SLACK_SIGNING_SECRET))) {
    return new Response("forbidden", { status: 403 });
  }
  const form = new URLSearchParams(raw);
  switch (form.get("command")) {
    case "/online":
      return loginCommand(form, env, ctx, true);
    case "/offline":
      return loginCommand(form, env, ctx, false);
    case "/queues":
    case "/file":
      return statusCommand(form, env, ctx);
    default:
      return ephemeral(messages(env).unknownCommand(form.get("command")));
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/slack/commands" && request.method === "POST") {
      return handleSlashCommand(request, env, ctx);
    }
    return new Response("not found", { status: 404 });
  },
};
