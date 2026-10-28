#!/usr/bin/env python3
"""AMI gate: a strict filter between the Cloudflare Tunnel and Asterisk's HTTP manager.

    cloudflared tunnel → 127.0.0.1:8090 (this gate) → 127.0.0.1:8088/rawman (Asterisk)

Everything coming out of the tunnel reaches Asterisk "from 127.0.0.1". Without this gate, any
AMI account (including FreePBX's own internal account, which has every right) could be used
through the tunnel. The gate only lets through what the Slack Worker needs:

- the Worker's secret key (X-Edge-Key header), compared in constant time;
- the /rawman page, GET only;
- the AMI user GATE_AMI_USER and no other;
- the Login, Logoff, QueueAdd, QueueRemove, QueueStatus and UserEvent actions, each with only
  its allowed parameters, in the formats FreePBX itself uses (like the *45 feature code);
- the GATE_QUEUES queues and GATE_EXTENSIONS extensions only.

Any ambiguous request is refused (unknown or repeated parameter, control characters, invalid
encoding). The request sent to Asterisk is rebuilt from the checked parameters only.
No dependencies: Python 3 standard library.

Configuration (environment variables, see ami-gate.service):
    GATE_PORT         local listening port (default 8090)
    GATE_UPSTREAM     Asterisk rawman page (default http://127.0.0.1:8088/rawman)
    GATE_AMI_USER     the only AMI user accepted (required)
    GATE_QUEUES       allowed queues, e.g. 1000,1001
    GATE_EXTENSIONS   allowed extensions, e.g. 201,202,203
    The secret key is read from the "edge-key" file provided by systemd (LoadCredential),
    or from GATE_KEY_FILE.
"""

import hmac
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("GATE_PORT", "8090"))
UPSTREAM = os.environ.get("GATE_UPSTREAM", "http://127.0.0.1:8088/rawman")
AMI_USER = os.environ.get("GATE_AMI_USER", "").strip()
QUEUES = {q.strip() for q in os.environ.get("GATE_QUEUES", "").split(",") if q.strip()}
EXTENSIONS = {e.strip() for e in os.environ.get("GATE_EXTENSIONS", "").split(",") if e.strip()}

# Accepted formats (the ones FreePBX uses for *45).
DIGITS = re.compile(r"^[0-9]{1,10}$")
MEMBER = re.compile(r"^Local/([0-9]{2,10})@from-(queue|internal)/n$")
HINT = re.compile(r"^hint:([0-9]{2,10})@ext-local$")
NAME = re.compile(r"^[^\x00-\x1f\x7f]{1,64}$")  # display name: no control characters
SECRET = re.compile(r"^[A-Za-z0-9]{8,128}$")
COOKIE = re.compile(r'^mansession_id="?[0-9a-fA-F]{1,64}"?$')


def _queue(value):
    return bool(DIGITS.match(value)) and (not QUEUES or value in QUEUES)


def _extension(value):
    return not EXTENSIONS or value in EXTENSIONS


def _member(value, from_queue_only):
    m = MEMBER.match(value)
    return bool(m) and _extension(m.group(1)) and (m.group(2) == "queue" or not from_queue_only)


def _hint(value):
    m = HINT.match(value)
    return bool(m) and _extension(m.group(1))


# For each allowed action: {parameter (lowercase): (name sent to Asterisk, check, required)}.
RULES = {
    "login": {
        "username": ("Username", lambda v: bool(AMI_USER) and v == AMI_USER, True),
        "secret": ("Secret", lambda v: bool(SECRET.match(v)), True),
    },
    "logoff": {},
    "queueadd": {
        "queue": ("Queue", _queue, True),
        "interface": ("Interface", lambda v: _member(v, True), True),
        "membername": ("MemberName", lambda v: bool(NAME.match(v)), False),
        "stateinterface": ("StateInterface", _hint, False),
        "penalty": ("Penalty", lambda v: bool(DIGITS.match(v)), False),
        "paused": ("Paused", lambda v: v in ("true", "false"), False),
    },
    "queueremove": {
        "queue": ("Queue", _queue, True),
        "interface": ("Interface", lambda v: _member(v, False), True),
    },
    "queuestatus": {
        "queue": ("Queue", _queue, False),
    },
    "userevent": {
        "userevent": ("UserEvent", lambda v: v in ("AgentLogin", "RefreshQueue"), True),
        "agent": ("Agent", lambda v: bool(DIGITS.match(v)) and _extension(v), False),
    },
}
ACTION_NAMES = {
    "login": "Login",
    "logoff": "Logoff",
    "queueadd": "QueueAdd",
    "queueremove": "QueueRemove",
    "queuestatus": "QueueStatus",
    "userevent": "UserEvent",
}


def check(query):
    """Checks the query string. Returns (parameters to forward, None) or (None, reason for refusal)."""
    try:
        pairs = urllib.parse.parse_qsl(
            query, keep_blank_values=True, strict_parsing=True, encoding="utf-8", errors="strict"
        )
    except (ValueError, UnicodeDecodeError):
        return None, "unreadable request"

    params = {}
    for key, value in pairs:
        k = key.lower()
        if k in params:
            return None, f"repeated parameter: {k}"
        if re.search(r"[\x00-\x1f\x7f]", key + value):
            return None, "control character"
        params[k] = value

    action = params.pop("action", "").lower()
    rules = RULES.get(action)
    if rules is None:
        return None, f"action not allowed: {action or '(none)'}"

    out = [("Action", ACTION_NAMES[action])]
    for k, value in params.items():
        rule = rules.get(k)
        if rule is None:
            return None, f"parameter not allowed for {action}: {k}"
        name, valid, _ = rule
        if not valid(value):
            return None, f"value refused for {action}.{k}"
        out.append((name, value))
    for k, (_, _, required) in rules.items():
        if required and k not in params:
            return None, f"missing parameter for {action}: {k}"
    return out, None


def load_key():
    path = os.environ.get("GATE_KEY_FILE") or os.path.join(os.environ.get("CREDENTIALS_DIRECTORY", ""), "edge-key")
    with open(path, encoding="utf-8") as f:
        key = f.read().strip()
    if len(key) < 32:
        sys.exit("secret key missing or too short (32 characters minimum)")
    return key


# No proxy: Asterisk runs on the same machine.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Gate(BaseHTTPRequestHandler):
    server_version = "ami-gate"
    sys_version = ""
    key = ""

    def _refuse(self, status, reason):
        body = f"refused: {reason}\n".encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        # Log without the request itself (it may contain the AMI password).
        print(f"REFUSED {status} {reason}", flush=True)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path != "/rawman":
            return self._refuse(404, "unknown page")
        if not hmac.compare_digest(self.headers.get("X-Edge-Key", "").encode("utf-8"), self.key.encode("utf-8")):
            return self._refuse(403, "missing or invalid key")
        params, reason = check(query)
        if params is None:
            return self._refuse(403, reason)

        headers = {}
        cookie = self.headers.get("Cookie", "").strip()
        if cookie:
            if not COOKIE.match(cookie):
                return self._refuse(403, "invalid session cookie")
            headers["Cookie"] = cookie

        request = urllib.request.Request(f"{UPSTREAM}?{urllib.parse.urlencode(params)}", headers=headers)
        try:
            with _opener.open(request, timeout=10) as res:
                status, body, res_headers = res.status, res.read(), res.headers
        except urllib.error.HTTPError as err:
            status, body, res_headers = err.code, err.read(), err.headers
        except OSError:
            return self._refuse(502, "Asterisk is not answering")

        self.send_response(status)
        self.send_header("Content-Type", res_headers.get("Content-Type", "text/plain"))
        if res_headers.get("Set-Cookie"):
            self.send_header("Set-Cookie", res_headers["Set-Cookie"])
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        print(f"OK {params[0][1]} → {status}", flush=True)

    def do_POST(self):
        self._refuse(405, "method not allowed")

    do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = do_POST

    def log_message(self, *args):
        pass  # custom log above, without the parameters


def main():
    if not AMI_USER:
        sys.exit("GATE_AMI_USER is required (the AMI user the Worker logs in with)")
    Gate.key = load_key()
    print(f"ami-gate: listening on 127.0.0.1:{PORT}, forwarding to {UPSTREAM}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Gate).serve_forever()


if __name__ == "__main__":
    main()
