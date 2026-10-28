/**
 * Minimal client for the Asterisk Manager Interface (AMI, the engine behind FreePBX), over HTTP ("rawman").
 *
 * The Worker reaches FreePBX through a Cloudflare Tunnel (AMI_URL, e.g. https://pbx-api.example.com).
 * A Cloudflare firewall (WAF) rule on that hostname blocks every request that does not carry the
 * X-Edge-Key header with the PBX_EDGE_KEY value, so only this Worker gets through. On the server,
 * the AMI gate (server/ami-gate.py) checks the key again and only lets queue actions reach Asterisk.
 */

// Turns an AMI response ("Key: value" lines, blocks separated by a blank line) into a list of objects,
// e.g. [{ Response: "Success", Message: "…" }, { Event: "QueueMember", … }].
export function parseAmi(text) {
  return String(text ?? "")
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const message = {};
      for (const line of block.split(/\r?\n/)) {
        const i = line.indexOf(":");
        if (i > 0) message[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      return message;
    })
    .filter((m) => Object.keys(m).length);
}

// Opens an AMI session, runs the actions one by one, then closes the session.
// `actions`: [{ Action: "QueueAdd", Queue: "1000", … }]. Returns one response per action
// (each response is a list of AMI messages, see parseAmi).
export async function amiRun(env, actions) {
  const base = String(env.AMI_URL ?? "").replace(/\/+$/, "");
  const headers = { "X-Edge-Key": env.PBX_EDGE_KEY ?? "" };

  const call = async (params) => {
    const res = await fetch(`${base}/rawman?${new URLSearchParams(params)}`, { headers });
    if (!res.ok) throw new Error(`FreePBX answered HTTP ${res.status}`);
    return { res, messages: parseAmi(await res.text()) };
  };

  // 1) Log in: Asterisk returns a session cookie (mansession_id) to send back.
  const login = await call({ Action: "Login", Username: env.AMI_USERNAME ?? "", Secret: env.AMI_SECRET ?? "" });
  if (login.messages[0]?.Response !== "Success") {
    throw new Error(`AMI login refused (${login.messages[0]?.Message ?? "unexpected answer"})`);
  }
  const cookie = (login.res.headers.get("set-cookie") ?? "").match(/mansession_id="?([^";]+)"?/)?.[1];
  if (cookie) headers.Cookie = `mansession_id="${cookie}"`;

  // 2) Actions, then 3) log off (even if an action failed).
  try {
    const results = [];
    for (const action of actions) results.push((await call(action)).messages);
    return results;
  } finally {
    await call({ Action: "Logoff" }).catch(() => {});
  }
}
