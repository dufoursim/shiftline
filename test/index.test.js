import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { parseAmi } from "../src/ami.js";
import { selectQueues, getConfig } from "../src/queues.js";

const env = {
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_SIGNING_SECRET: "signing-secret",
  AMI_URL: "https://pbx.test/asterisk/",
  AMI_USERNAME: "shiftline",
  AMI_SECRET: "ami-pass",
  PBX_EDGE_KEY: "edge-key",
  ANNOUNCE_CHANNEL: "CANNOUNCE",
  AGENTS: [
    { name: "Amélie Tremblay", extension: "201", slack: "UAMELIE", queues: ["1000", "1001"] },
    { name: "Jordan Smith", extension: "202", slack: "UJORDAN", queues: ["1000"] },
  ],
  QUEUES: {
    "1000": { name: "SALES", alias: "sales" },
    "1001": { name: "SUPPORT", alias: "support" },
  },
};
const envFr = { ...env, LANGUAGE: "fr" };

const ami = (...blocks) => blocks.map((b) => Object.entries(b).map(([k, v]) => `${k}: ${v}`).join("\r\n")).join("\r\n\r\n") + "\r\n\r\n";

// Fakes FreePBX (AMI over HTTP) and Slack. `answers`: AMI answer per action (e.g. { QueueAdd: "…" }).
function mockApis(answers = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const call = { url: u, host: u.hostname, action: u.searchParams.get("Action"), init };
    call.body = init.body ? JSON.parse(init.body) : null;
    calls.push(call);
    if (u.hostname === "pbx.test") {
      if (call.action === "Login") {
        return new Response(ami({ Response: "Success", Message: "Authentication accepted" }), {
          headers: { "set-cookie": 'mansession_id="abc123"; Version=1; Max-Age=60' },
        });
      }
      return new Response(answers[call.action] ?? ami({ Response: "Success", Message: "OK" }));
    }
    return Response.json({ ok: true });
  };
  return calls;
}

async function slackRequest(fields, secret = "signing-secret") {
  const raw = new URLSearchParams(fields).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${ts}:${raw}`));
  const sig = "v0=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://x.dev/slack/commands", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": ts, "x-slack-signature": sig },
    body: raw,
  });
}

function makeCtx() {
  const pending = [];
  return { waitUntil: (p) => pending.push(p), done: () => Promise.all(pending) };
}

const command = (cmd, text = "", user = "UAMELIE") => ({
  command: cmd,
  text,
  user_id: user,
  channel_id: "CANYWHERE",
  response_url: "https://hooks.slack.com/commands/T/1/x",
});

const reply = (calls) => calls.find((c) => c.host === "hooks.slack.com").body.text;
const announce = (calls) => calls.find((c) => c.url.pathname.endsWith("chat.postMessage"))?.body;

test("parses AMI answers (“Key: value” blocks)", () => {
  assert.deepEqual(parseAmi("Response: Success\r\nMessage: Added interface to queue\r\n\r\nEvent: X\r\nQueue: 1000\r\n\r\n"), [
    { Response: "Success", Message: "Added interface to queue" },
    { Event: "X", Queue: "1000" },
  ]);
});

test("picks the queues from the typed text", () => {
  const config = getConfig(env);
  const [amelie, jordan] = config.agents;
  assert.deepEqual(selectQueues(config, amelie, ""), { queues: ["1000", "1001"] });
  assert.deepEqual(selectQueues(config, amelie, " Support "), { queues: ["1001"] });
  assert.deepEqual(selectQueues(config, amelie, "1000"), { queues: ["1000"] });
  assert.match(selectQueues(config, jordan, "support").error, /not a member/);
  assert.match(selectQueues(config, amelie, "kitchen").error, /Unknown queue/);
});

test("/online logs the person into all their queues, like *45, and announces it", async () => {
  const calls = mockApis();
  const ctx = makeCtx();
  const res = await worker.fetch(await slackRequest(command("/online")), env, ctx);
  // No "in progress" message: Slack only shows the result.
  assert.equal(await res.text(), "");
  await ctx.done();

  const login = calls.find((c) => c.action === "Login");
  assert.equal(login.url.pathname, "/asterisk/rawman");
  assert.equal(login.url.searchParams.get("Username"), "shiftline");
  assert.equal(login.init.headers["X-Edge-Key"], "edge-key");

  const adds = calls.filter((c) => c.action === "QueueAdd");
  assert.deepEqual(adds.map((c) => c.url.searchParams.get("Queue")), ["1000", "1001"]);
  const q = adds[0].url.searchParams;
  assert.equal(q.get("Interface"), "Local/201@from-queue/n");
  assert.equal(q.get("StateInterface"), "hint:201@ext-local");
  assert.equal(q.get("MemberName"), "Amélie Tremblay");
  assert.equal(adds[0].init.headers.Cookie, 'mansession_id="abc123"');
  const event = calls.find((c) => c.action === "UserEvent").url.searchParams;
  assert.equal(event.get("UserEvent"), "AgentLogin");
  assert.equal(event.get("Agent"), "201");
  assert.ok(calls.some((c) => c.action === "Logoff"));

  assert.match(reply(calls), /online in: \*SALES, SUPPORT\*.*extension 201/);
  assert.equal(announce(calls).channel, "CANNOUNCE");
  assert.match(announce(calls).text, /Amélie Tremblay\* \(ext\. 201\) is online — SALES, SUPPORT/);
});

test("AMI_URL: trailing slashes are ignored", async () => {
  const calls = mockApis();
  const ctx = makeCtx();
  await worker.fetch(await slackRequest(command("/queues")), { ...env, AMI_URL: "https://pbx.test///" }, ctx);
  await ctx.done();
  assert.equal(calls.find((c) => c.action === "Login").url.href.split("?")[0], "https://pbx.test/rawman");
});

test("/online sales: a single queue; “already there” is not an error", async () => {
  const calls = mockApis({ QueueAdd: ami({ Response: "Error", Message: "Unable to add interface: Already there" }) });
  const ctx = makeCtx();
  await worker.fetch(await slackRequest(command("/online", "sales")), env, ctx);
  await ctx.done();
  assert.deepEqual(calls.filter((c) => c.action === "QueueAdd").map((c) => c.url.searchParams.get("Queue")), ["1000"]);
  assert.match(reply(calls), /online in: \*SALES\*/);
});

test("/offline logs the person out and announces it", async () => {
  const calls = mockApis();
  const ctx = makeCtx();
  await worker.fetch(await slackRequest(command("/offline", "", "UJORDAN")), env, ctx);
  await ctx.done();
  const removes = calls.filter((c) => c.action === "QueueRemove");
  assert.deepEqual(removes.map((c) => c.url.searchParams.get("Interface")), ["Local/202@from-queue/n", "Local/202@from-internal/n"]);
  assert.equal(calls.find((c) => c.action === "UserEvent").url.searchParams.get("UserEvent"), "RefreshQueue");
  assert.match(announce(calls).text, /Jordan Smith\* \(ext\. 202\) is offline — SALES/);
});

test("reports a failed queue without announcing it as done", async () => {
  const calls = mockApis({ QueueAdd: ami({ Response: "Error", Message: "Unable to add interface to queue: No such queue" }) });
  const ctx = makeCtx();
  await worker.fetch(await slackRequest(command("/online", "support")), env, ctx);
  await ctx.done();
  assert.match(reply(calls), /:warning: SUPPORT: Unable to add interface to queue: No such queue/);
  assert.equal(announce(calls), undefined);
});

test("reports a refused AMI login, without changing anything", async () => {
  const calls = mockApis();
  globalThis.fetch = async (url) => {
    calls.push({ host: new URL(url).hostname, url: new URL(url), body: null });
    if (new URL(url).hostname === "pbx.test") return new Response(ami({ Response: "Error", Message: "Authentication failed" }));
    return Response.json({ ok: true });
  };
  const ctx = makeCtx();
  await worker.fetch(await slackRequest(command("/online")), env, ctx);
  await ctx.done();
  assert.ok(!calls.some((c) => c.url.searchParams.get("Action") === "QueueAdd"));
});

test("refuses a Slack account not linked to any extension", async () => {
  const calls = mockApis();
  const res = await worker.fetch(await slackRequest(command("/online", "", "UNKNOWN")), env, makeCtx());
  assert.match((await res.json()).text, /not linked to any phone extension/);
  assert.equal(calls.length, 0);
});

test("refuses a badly signed command", async () => {
  const calls = mockApis();
  const res = await worker.fetch(await slackRequest(command("/online"), "wrong"), env, makeCtx());
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

const statusAnswer = () =>
  ami(
    { Response: "Success", EventList: "start", Message: "Queue status will follow" },
    { Event: "QueueParams", Queue: "1000", Calls: "2" },
    { Event: "QueueMember", Queue: "1000", Name: "Amélie Tremblay", Location: "Local/201@from-queue/n", Status: "1", Paused: "0" },
    { Event: "QueueMember", Queue: "1000", Name: "Jordan Smith", Location: "Local/202@from-queue/n", Status: "2", Paused: "0" },
    { Event: "QueueParams", Queue: "1001", Calls: "0" },
    { Event: "QueueParams", Queue: "9999", Calls: "5" },
    { Event: "QueueStatusComplete", EventList: "Complete" },
  );

test("/queues shows the waiting calls and each agent's state", async () => {
  const calls = mockApis({ QueueStatus: statusAnswer() });
  const ctx = makeCtx();
  await worker.fetch(await slackRequest(command("/queues")), env, ctx);
  await ctx.done();
  const text = reply(calls);
  assert.match(text, /SALES\* \(1000\) — :hourglass: \*2\* calls waiting/);
  assert.match(text, /Amélie Tremblay \(201\) — :large_green_circle: available/);
  assert.match(text, /Jordan Smith \(202\) — :telephone_receiver: on a call/);
  assert.match(text, /SUPPORT\* \(1001\) — no calls waiting\n {3}_Nobody online_/);
  assert.doesNotMatch(text, /9999/);
});

test("LANGUAGE = fr: the bot answers in French, and /file is the status command", async () => {
  const calls = mockApis({ QueueStatus: statusAnswer() });
  const ctx = makeCtx();
  await worker.fetch(await slackRequest(command("/file")), envFr, ctx);
  await ctx.done();
  const text = reply(calls);
  assert.match(text, /Files d'attente en ce moment/);
  assert.match(text, /\*2\* appels en attente/);
  assert.match(text, /Jordan Smith \(202\) — :telephone_receiver: en appel/);

  const res = await worker.fetch(await slackRequest(command("/online", "cuisine")), envFr, makeCtx());
  assert.match((await res.json()).text, /File « cuisine » inconnue/);
});

test("in the announcement channel, the announcement is enough: no duplicate private confirmation", async () => {
  const calls = mockApis();
  const ctx = makeCtx();
  await worker.fetch(await slackRequest({ ...command("/online", "sales"), channel_id: "CANNOUNCE" }), env, ctx);
  await ctx.done();
  assert.match(announce(calls).text, /Amélie Tremblay\* \(ext\. 201\) is online/);
  assert.ok(!calls.some((c) => c.host === "hooks.slack.com"));
});

test("in the announcement channel, an error is still reported privately", async () => {
  const calls = mockApis({ QueueAdd: ami({ Response: "Error", Message: "Unable to add interface to queue: No such queue" }) });
  const ctx = makeCtx();
  await worker.fetch(await slackRequest({ ...command("/online", "support"), channel_id: "CANNOUNCE" }), env, ctx);
  await ctx.done();
  assert.match(reply(calls), /:warning: SUPPORT/);
});

test("without ANNOUNCE_CHANNEL, the person still gets a private confirmation", async () => {
  const calls = mockApis();
  const ctx = makeCtx();
  await worker.fetch(await slackRequest(command("/offline", "sales")), { ...env, ANNOUNCE_CHANNEL: "" }, ctx);
  await ctx.done();
  assert.equal(announce(calls), undefined);
  assert.match(reply(calls), /offline for: \*SALES\*/);
});
