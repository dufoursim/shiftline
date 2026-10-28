"""Tests for the AMI gate (server/ami-gate.py). Run: python3 -m unittest discover -s test -p "test_*.py"."""

import http.server
import importlib.util
import os
import pathlib
import threading
import unittest
import urllib.error
import urllib.request

KEY = "k" * 40
os.environ.update(
    {
        "GATE_AMI_USER": "shiftline",
        "GATE_QUEUES": "1000,1001",
        "GATE_EXTENSIONS": "201,202",
    }
)
_path = pathlib.Path(__file__).resolve().parent.parent / "server" / "ami-gate.py"
_spec = importlib.util.spec_from_file_location("ami_gate", _path)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


def ok(query):
    params, reason = gate.check(query)
    assert params is not None, reason
    return params


def refused(query):
    params, reason = gate.check(query)
    assert params is None, f"should have been refused: {query}"
    return reason


class CheckTest(unittest.TestCase):
    def test_the_workers_requests_pass(self):
        self.assertEqual(
            ok("Action=Login&Username=shiftline&Secret=abc12345XYZ"),
            [("Action", "Login"), ("Username", "shiftline"), ("Secret", "abc12345XYZ")],
        )
        ok("Action=QueueAdd&Queue=1000&Interface=Local%2F201%40from-queue%2Fn&MemberName=Am%C3%A9lie+Tremblay"
           "&StateInterface=hint%3A201%40ext-local&Penalty=0&Paused=false")
        ok("Action=QueueRemove&Queue=1001&Interface=Local%2F201%40from-internal%2Fn")
        ok("Action=QueueStatus")
        ok("Action=UserEvent&UserEvent=AgentLogin&Agent=201")
        ok("Action=Logoff")

    def test_the_forwarded_request_is_rebuilt(self):
        # Parameter names are normalized, whatever their case.
        self.assertEqual(ok("aCtIoN=logoff"), [("Action", "Logoff")])

    def test_refuses_another_ami_account(self):
        self.assertIn("value refused", refused("Action=Login&Username=freepbxinternal&Secret=abc12345XYZ"))
        refused("Action=Login&Username=admin&Secret=abc12345XYZ")

    def test_refuses_dangerous_actions(self):
        for action in ("Originate", "Command", "Setvar", "Redirect", "Hangup", "DBPut", "GetConfig", "UpdateConfig"):
            self.assertIn("not allowed", refused(f"Action={action}"), action)
        self.assertIn("none", refused(""))

    def test_refuses_repeated_parameters_even_with_another_case(self):
        self.assertIn("repeated", refused("Action=Login&Username=shiftline&Secret=abc12345XYZ&username=admin"))
        self.assertIn("repeated", refused("Action=Logoff&action=Command"))

    def test_refuses_header_injection(self):
        self.assertIn("control", refused("Action=QueueStatus&Queue=1000%0D%0AAction%3A+Command"))
        self.assertIn("control", refused("Action=Login&Username=shiftline%0A&Secret=abc12345XYZ"))

    def test_refuses_parameters_not_allowed(self):
        self.assertIn("not allowed", refused("Action=QueueStatus&Variable=x"))
        self.assertIn("not allowed", refused("Action=Logoff&ActionID=1"))

    def test_refuses_queues_and_extensions_off_the_list(self):
        refused("Action=QueueAdd&Queue=2000&Interface=Local%2F201%40from-queue%2Fn")
        refused("Action=QueueAdd&Queue=1000&Interface=Local%2F999%40from-queue%2Fn")
        refused("Action=QueueAdd&Queue=1000&Interface=SIP%2Ftrunk")
        refused("Action=QueueAdd&Queue=1000&Interface=Local%2F201%40from-internal%2Fn")  # adding: from-queue only
        refused("Action=QueueAdd&Queue=1000&Interface=Local%2F201%40from-queue%2Fn&StateInterface=hint%3A999%40ext-local")
        refused("Action=UserEvent&UserEvent=Bogus")

    def test_refuses_missing_required_parameters(self):
        self.assertIn("missing", refused("Action=QueueAdd&Queue=1000"))
        self.assertIn("missing", refused("Action=Login&Username=shiftline"))

    def test_refuses_invalid_encoding(self):
        refused("Action=Login&Username=shiftline&Secret=%FF%FE")
        refused("Action")


class FakeAsterisk(http.server.BaseHTTPRequestHandler):
    seen = []

    def do_GET(self):
        FakeAsterisk.seen.append((self.path, self.headers.get("Cookie")))
        body = b"Response: Success\r\nMessage: Authentication accepted\r\n\r\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Set-Cookie", 'mansession_id="abc123"; Version=1; Max-Age=60')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class EndToEndTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.asterisk = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeAsterisk)
        threading.Thread(target=cls.asterisk.serve_forever, daemon=True).start()
        gate.UPSTREAM = f"http://127.0.0.1:{cls.asterisk.server_address[1]}/rawman"
        gate.Gate.key = KEY
        cls.gate = http.server.ThreadingHTTPServer(("127.0.0.1", 0), gate.Gate)
        threading.Thread(target=cls.gate.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.gate.server_address[1]}"
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.gate.shutdown()
        cls.asterisk.shutdown()

    def get(self, path, key=KEY, cookie=None):
        headers = {"X-Edge-Key": key}
        if cookie:
            headers["Cookie"] = cookie
        try:
            with self.opener.open(urllib.request.Request(self.base + path, headers=headers), timeout=5) as res:
                return res.status, res.read().decode(), res.headers
        except urllib.error.HTTPError as err:
            return err.code, err.read().decode(), err.headers

    def test_forwards_an_allowed_request_and_the_session_cookie(self):
        FakeAsterisk.seen.clear()
        status, body, headers = self.get("/rawman?action=login&username=shiftline&secret=abc12345XYZ")
        self.assertEqual(status, 200)
        self.assertIn("Authentication accepted", body)
        self.assertIn("mansession_id", headers.get("Set-Cookie"))
        self.assertEqual(FakeAsterisk.seen[-1][0], "/rawman?Action=Login&Username=shiftline&Secret=abc12345XYZ")

        status, _, _ = self.get("/rawman?Action=QueueStatus", cookie='mansession_id="abc123"')
        self.assertEqual(status, 200)
        self.assertEqual(FakeAsterisk.seen[-1], ("/rawman?Action=QueueStatus", 'mansession_id="abc123"'))

    def test_refuses_without_the_right_key(self):
        FakeAsterisk.seen.clear()
        self.assertEqual(self.get("/rawman?Action=Logoff", key="wrong")[0], 403)
        self.assertEqual(self.get("/rawman?Action=Logoff", key="é" * 40)[0], 403)
        self.assertEqual(FakeAsterisk.seen, [])

    def test_refuses_other_pages_and_forbidden_requests(self):
        FakeAsterisk.seen.clear()
        self.assertEqual(self.get("/manager?Action=Logoff")[0], 404)
        self.assertEqual(self.get("/rawman?Action=Command&Command=core+show+version")[0], 403)
        self.assertEqual(self.get("/rawman?Action=QueueStatus", cookie="other=1")[0], 403)
        self.assertEqual(FakeAsterisk.seen, [])


if __name__ == "__main__":
    unittest.main()
