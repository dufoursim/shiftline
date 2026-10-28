/**
 * FreePBX queues: agent login and logout, queue status.
 *
 * Agents are logged in exactly like FreePBX's *45 feature code (macro-toggle-add-agent / -del-agent):
 * dynamic member "Local/EXT@from-queue/n" whose state (idle, on a call…) follows the extension
 * (hint:EXT@ext-local), then UserEvent AgentLogin / RefreshQueue. On logout, the older
 * "Local/EXT@from-internal/n" format is removed too. The only difference: queue BLF lamps
 * (DEVICE_STATE Custom:QUEUE…) are not updated, since that needs the much broader AMI "call" right.
 * So /online and *45 work together: an agent logged in with *45 shows up in /file and can /offline.
 */
import { amiRun } from "./ami.js";
import { messages } from "./messages.js";

export const memberInterface = (extension) => `Local/${extension}@from-queue/n`;
const stateInterface = (extension) => `hint:${extension}@ext-local`;

// Reads the configuration (wrangler.toml): QUEUES = { "1000": { name, alias } }, AGENTS = [{ name, extension, slack, queues }].
export function getConfig(env) {
  const read = (value) => (typeof value === "string" ? JSON.parse(value) : value);
  return { queues: read(env.QUEUES) ?? {}, agents: read(env.AGENTS) ?? [] };
}

// Agent linked to a Slack account (null when the account is not linked to any extension).
export function agentForSlackUser(config, slackUserId) {
  return config.agents.find((a) => a.slack && a.slack === slackUserId) ?? null;
}

export const queueLabel = (config, id) => config.queues[id]?.name ?? id;

// Queues targeted by the text typed after the command: "" = all of the agent's queues,
// otherwise the alias ("sales") or the number ("1000") of one of them.
// Returns { queues: ["1000", …] } or { error: "message" }.
export function selectQueues(config, agent, text, t = messages({})) {
  const wanted = String(text ?? "").trim().toLowerCase();
  if (!wanted) return { queues: agent.queues };
  const id = Object.keys(config.queues).find((q) => q === wanted || config.queues[q].alias?.toLowerCase() === wanted);
  if (!id) {
    const choices = agent.queues.map((q) => `\`${config.queues[q]?.alias ?? q}\``).join(", ");
    return { error: t.unknownQueue(text.trim(), choices) };
  }
  if (!agent.queues.includes(id)) return { error: t.notMember(queueLabel(config, id)) };
  return { queues: [id] };
}

// Asterisk answers "Already there" / "Not there" when the agent is already in the requested state:
// that is not an error.
function isOk(messages, alreadyDone) {
  const r = messages[0] ?? {};
  return r.Response === "Success" || alreadyDone.test(r.Message ?? "");
}

// Logs the agent into `queues`. Returns { ok: [...], failed: [{ queue, message }] }.
export async function login(env, agent, queues) {
  const results = await amiRun(env, [
    ...queues.map((queue) => ({
      Action: "QueueAdd",
      Queue: queue,
      Interface: memberInterface(agent.extension),
      MemberName: agent.name,
      StateInterface: stateInterface(agent.extension),
      Penalty: "0",
      Paused: "false",
    })),
    // Like *45 (macro-toggle-add-agent): tells FreePBX an agent logged in.
    { Action: "UserEvent", UserEvent: "AgentLogin", Agent: agent.extension },
  ]);
  return summarize(env, queues, results, /already there/i);
}

// Logs the agent out of `queues`.
export async function logout(env, agent, queues) {
  const results = await amiRun(env, [
    ...queues.map((queue) => ({ Action: "QueueRemove", Queue: queue, Interface: memberInterface(agent.extension) })),
    // Like *45 (macro-toggle-del-agent): also removes the older from-internal format, then tells FreePBX.
    ...queues.map((queue) => ({
      Action: "QueueRemove",
      Queue: queue,
      Interface: `Local/${agent.extension}@from-internal/n`,
    })),
    { Action: "UserEvent", UserEvent: "RefreshQueue" },
  ]);
  return summarize(env, queues, results, /not there|not found/i);
}

function summarize(env, queues, results, alreadyDone) {
  const ok = [];
  const failed = [];
  queues.forEach((queue, i) => {
    if (isOk(results[i], alreadyDone)) ok.push(queue);
    else failed.push({ queue, message: results[i][0]?.Message ?? messages(env).unknownError });
  });
  return { ok, failed };
}

// Status of the configured queues: { "1000": { waiting, members: [{ name, extension, status, paused }] } }.
export async function queueStatus(env, config) {
  const [events] = await amiRun(env, [{ Action: "QueueStatus" }]);
  const status = {};
  for (const id of Object.keys(config.queues)) status[id] = { waiting: 0, members: [] };
  for (const m of events) {
    if (!status[m.Queue]) continue;
    if (m.Event === "QueueParams") status[m.Queue].waiting = Number(m.Calls) || 0;
    if (m.Event === "QueueMember") {
      const location = m.Location ?? m.Interface ?? "";
      status[m.Queue].members.push({
        name: m.Name ?? m.MemberName ?? location,
        extension: location.match(/^Local\/(\w+)@/)?.[1] ?? "",
        status: Number(m.Status),
        paused: m.Paused === "1",
      });
    }
  }
  return status;
}

// A member's state (Asterisk "Status" codes) as text with an emoji.
export function memberState(member, t = messages({})) {
  if (member.paused) return t.states.paused;
  switch (member.status) {
    case 1:
      return t.states.available;
    case 2:
    case 3:
    case 8:
      return t.states.inCall;
    case 6:
    case 7:
      return t.states.ringing;
    case 4:
    case 5:
      return t.states.unreachable;
    default:
      return t.states.unknown;
  }
}
