# Server setup (FreePBX 17, Debian 12)

[Version française](INSTALLATION-SERVEUR.fr.md)

Done **once**, over SSH on the FreePBX server, with an account that can use `sudo`. At the end, the
Worker reaches Asterisk's HTTP manager through a Cloudflare Tunnel and the AMI gate, **with no open
port** on the server.

```
Worker → https://pbx-api.example.com → Cloudflare Tunnel → AMI gate (127.0.0.1:8090) → Asterisk (127.0.0.1:8088/rawman)
```

In the commands below, replace:

| Placeholder | Your value |
|---|---|
| `pbx-api.example.com` | the hostname you chose for the tunnel |
| `shiftline` | the tunnel name |
| `shiftline` | the AMI user created in FreePBX |
| `YOUR_KEY` | the `PBX_EDGE_KEY` (same as the firewall rule) |

## Before you start

- The **AMI user** exists in FreePBX (README, step 4): rights `agent` (Read + Write) and `user`
  (Write) only, Permit `127.0.0.1/255.255.255.255`.
- The **Cloudflare firewall rule** exists (README, step 5). ⚠️ It must exist **before** the tunnel
  starts (step 7), otherwise the hostname is reachable without the key.

## Connect to the server

From Windows (PowerShell), macOS or Linux, with your SSH key (replace the key path, user and server):

```bash
ssh -i ~/.ssh/id_ed25519 admin@pbx.example.com
```

If your hosting company issued an **SSH certificate** (`id_ed25519-cert.pub` next to the key), SSH
uses it automatically; note its expiry date. Then check that you can use `sudo` (no error expected):

```bash
sudo -v
```

## 1. Check Asterisk's HTTP server

```bash
sudo asterisk -rx "http show status"
```

Expected: `Server Enabled and Bound to 127.0.0.1:8088`. Note the **prefix** (`Prefix:`). If it is
not empty (e.g. `/asterisk`), the gate must forward to `http://127.0.0.1:8088/asterisk/rawman`: set
`GATE_UPSTREAM` to that in step 4. Nothing else changes (`AMI_URL` and the tunnel keep `/rawman`).

If the HTTP server is disabled: FreePBX → **Settings → Advanced Settings** → *Asterisk Builtin
mini-HTTP server* → **Enable the mini-HTTP Server** = Yes, then **Apply Config**.

## 2. Enable AMI over HTTP (`webenabled`)

⚠️ `manager.conf` also contains FreePBX's internal AMI password: do not paste its content anywhere.
Check only the setting:

```bash
sudo grep -n "webenabled" /etc/asterisk/manager.conf /etc/asterisk/manager_custom.conf
```

If `webenabled = yes` is not there, add it to `manager_custom.conf` (FreePBX never overwrites this
file; `(+)` adds to the existing `[general]` section):

```bash
printf '\n[general](+)\nwebenabled = yes\n' | sudo tee -a /etc/asterisk/manager_custom.conf
```

```bash
sudo asterisk -rx "manager reload"
```

```bash
sudo asterisk -rx "http show status" | grep -i rawman
```

Expected: `/rawman => Raw HTTP Manager Event Interface`.

## 3. Test the AMI user locally (read-only)

Replace `AMI_PASSWORD` with the AMI user's password:

```bash
curl -s -c /tmp/ami.txt "http://127.0.0.1:8088/rawman?action=Login&username=shiftline&secret=AMI_PASSWORD"
```

```bash
curl -s -b /tmp/ami.txt "http://127.0.0.1:8088/rawman?action=QueueStatus"
```

```bash
curl -s -b /tmp/ami.txt "http://127.0.0.1:8088/rawman?action=Logoff"; rm -f /tmp/ami.txt
```

Expected: `Authentication accepted`, then `Event: QueueParams` blocks, then `Response: Goodbye`.

## 4. Install the AMI gate

Copy `server/ami-gate.py` to `/opt/ami-gate/ami-gate.py` and `server/ami-gate.service` to
`/etc/systemd/system/ami-gate.service` (with `scp`, or by pasting each file into
`sudo tee FILE >/dev/null`). In the service file, set `GATE_AMI_USER`, `GATE_QUEUES` and
`GATE_EXTENSIONS` (allowed queues and extensions), and `GATE_UPSTREAM` if step 1 showed a prefix.

```bash
sudo mkdir -p /opt/ami-gate /etc/ami-gate
```

Store the Worker's key, readable by root only:

```bash
printf '%s' 'YOUR_KEY' | sudo tee /etc/ami-gate/edge-key >/dev/null && sudo chmod 600 /etc/ami-gate/edge-key
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ami-gate && sudo systemctl status ami-gate --no-pager
```

Expected: `active (running)` and `ami-gate: listening on 127.0.0.1:8090`. Check that it refuses
what is forbidden and forwards the rest:

```bash
curl -s -H "X-Edge-Key: $(sudo cat /etc/ami-gate/edge-key)" "http://127.0.0.1:8090/rawman?Action=Command&Command=core+show+version"
```

```bash
curl -s -H "X-Edge-Key: $(sudo cat /etc/ami-gate/edge-key)" "http://127.0.0.1:8090/rawman?Action=Logoff"
```

Expected: `refused: action not allowed: command`, then an answer from Asterisk (`Response: …`).

## 5. Install cloudflared (official Cloudflare repository for Debian 12)

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
```

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
```

```bash
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
```

```bash
sudo apt-get update && sudo apt-get install -y cloudflared
```

```bash
cloudflared --version
```

## 6. Create and configure the tunnel

Without `sudo`. The first command prints a `https://dash.cloudflare.com/argotunnel?...` address:
open it in a browser, pick your domain, **Authorize**.

```bash
cloudflared tunnel login
```

```bash
cloudflared tunnel create shiftline
```

Note the **tunnel ID** it prints, then create the hostname:

```bash
cloudflared tunnel route dns shiftline pbx-api.example.com
```

Move the credentials to `/etc/cloudflared` (replace `TUNNEL_ID` everywhere):

```bash
sudo mkdir -p /etc/cloudflared && sudo cp ~/.cloudflared/TUNNEL_ID.json /etc/cloudflared/ && sudo chmod 600 /etc/cloudflared/TUNNEL_ID.json
```

Only `/rawman` goes to the gate (port **8090**, never Asterisk's 8088 directly); everything else
gets a 404:

```bash
sudo tee /etc/cloudflared/config.yml >/dev/null <<'EOF'
tunnel: TUNNEL_ID
credentials-file: /etc/cloudflared/TUNNEL_ID.json

ingress:
  - hostname: pbx-api.example.com
    path: ^/rawman$
    service: http://127.0.0.1:8090
  - service: http_status:404
EOF
```

Then:

```bash
sudo cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate
```

Expected: `OK`.

## 7. Start the tunnel as a service

⚠️ Check first that the Cloudflare firewall rule exists.

```bash
sudo cloudflared service install
```

```bash
sudo systemctl status cloudflared --no-pager
```

Expected: `active (running)` and `enabled`.

## 8. Check from the outside

From any computer, **without** the key (Windows: `curl.exe` and `NUL`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://pbx-api.example.com/rawman?action=Ping"
```

Expected: `403`, blocked by Cloudflare. Then test in Slack (README, step 8).

## Maintenance

| I want to… | Command |
|---|---|
| See what the gate accepts and refuses | `sudo journalctl -u ami-gate -n 50 --no-pager` |
| Add a queue or extension to the gate | Edit `GATE_QUEUES` / `GATE_EXTENSIONS`, then `sudo systemctl daemon-reload && sudo systemctl restart ami-gate` |
| Change the key | `/etc/ami-gate/edge-key` + `sudo systemctl restart ami-gate`, the firewall rule, and `npx wrangler secret put PBX_EDGE_KEY`, at the same time |
| Cut the bot's access to the PBX | `sudo systemctl stop cloudflared` |
| Update cloudflared | `sudo apt-get update && sudo apt-get install --only-upgrade cloudflared` |
| Remove everything | `sudo systemctl disable --now cloudflared ami-gate`, `sudo cloudflared service uninstall`, `cloudflared tunnel delete shiftline` |
