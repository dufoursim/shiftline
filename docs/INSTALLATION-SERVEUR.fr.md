# Installation sur le serveur (FreePBX 17, Debian 12)

[English version](SERVER-SETUP.md)

À faire **une seule fois**, en SSH sur le serveur FreePBX, avec un compte qui peut utiliser `sudo`.
À la fin, le Worker joint l'AMI d'Asterisk par un tunnel Cloudflare et le gardien AMI, **sans aucun
port ouvert** sur le serveur.

```
Worker → https://pbx-api.example.com → tunnel Cloudflare → gardien AMI (127.0.0.1:8090) → Asterisk (127.0.0.1:8088/rawman)
```

Dans les commandes ci-dessous, remplacez :

| Exemple | Votre valeur |
|---|---|
| `pbx-api.example.com` | l'adresse choisie pour le tunnel |
| `shiftline` | le nom du tunnel |
| `shiftline` | l'utilisateur AMI créé dans FreePBX |
| `VOTRE_CLÉ` | la clé `PBX_EDGE_KEY` (la même que dans la règle de pare-feu) |

## Avant de commencer

- L'**utilisateur AMI** existe dans FreePBX (README, étape 4) : droits `agent` (Read + Write) et
  `user` (Write) seulement, Permit `127.0.0.1/255.255.255.255`.
- La **règle de pare-feu Cloudflare** existe (README, étape 5). ⚠️ Elle doit exister **avant** de
  démarrer le tunnel (étape 7), sinon l'adresse est joignable sans la clé.

## Se connecter au serveur

Depuis Windows (PowerShell), macOS ou Linux, avec votre clé SSH (remplacez le chemin de la clé,
l'utilisateur et le serveur ; sous Windows, la clé est souvent dans `C:\Users\VOTRE-NOM\.ssh\`) :

```bash
ssh -i ~/.ssh/id_ed25519 admin@pbx.example.com
```

Si votre hébergeur vous a remis un **certificat SSH** (`id_ed25519-cert.pub` à côté de la clé), SSH
l'utilise automatiquement ; notez sa date d'expiration. Vérifiez ensuite que vous pouvez utiliser
`sudo` (aucune erreur attendue) :

```bash
sudo -v
```

## 1. Vérifier le serveur HTTP d'Asterisk

```bash
sudo asterisk -rx "http show status"
```

Attendu : `Server Enabled and Bound to 127.0.0.1:8088`. Notez le **préfixe** (`Prefix:`). S'il
n'est pas vide (ex. `/asterisk`), le gardien doit transmettre à `http://127.0.0.1:8088/asterisk/rawman` :
mettez cette adresse dans `GATE_UPSTREAM` à l'étape 4. Rien d'autre ne change (`AMI_URL` et le
tunnel gardent `/rawman`).

Si le serveur HTTP est désactivé : FreePBX → **Settings → Advanced Settings** → *Asterisk Builtin
mini-HTTP server* → **Enable the mini-HTTP Server** = Yes, puis **Apply Config**.

## 2. Activer l'AMI en HTTP (`webenabled`)

⚠️ `manager.conf` contient aussi le mot de passe AMI interne de FreePBX : n'en copiez le contenu
nulle part. Vérifiez seulement le réglage :

```bash
sudo grep -n "webenabled" /etc/asterisk/manager.conf /etc/asterisk/manager_custom.conf
```

Si `webenabled = yes` n'y est pas, ajoutez-le dans `manager_custom.conf` (jamais écrasé par
FreePBX ; `(+)` ajoute à la section `[general]` existante) :

```bash
printf '\n[general](+)\nwebenabled = yes\n' | sudo tee -a /etc/asterisk/manager_custom.conf
```

```bash
sudo asterisk -rx "manager reload"
```

```bash
sudo asterisk -rx "http show status" | grep -i rawman
```

Attendu : `/rawman => Raw HTTP Manager Event Interface`.

## 3. Tester l'utilisateur AMI en local (lecture seule)

Remplacez `MOT_DE_PASSE_AMI` par le mot de passe de l'utilisateur AMI :

```bash
curl -s -c /tmp/ami.txt "http://127.0.0.1:8088/rawman?action=Login&username=shiftline&secret=MOT_DE_PASSE_AMI"
```

```bash
curl -s -b /tmp/ami.txt "http://127.0.0.1:8088/rawman?action=QueueStatus"
```

```bash
curl -s -b /tmp/ami.txt "http://127.0.0.1:8088/rawman?action=Logoff"; rm -f /tmp/ami.txt
```

Attendu : `Authentication accepted`, puis des blocs `Event: QueueParams`, puis `Response: Goodbye`.

## 4. Installer le gardien AMI

Copiez `server/ami-gate.py` dans `/opt/ami-gate/ami-gate.py` et `server/ami-gate.service` dans
`/etc/systemd/system/ami-gate.service` (avec `scp`, ou en collant chaque fichier dans
`sudo tee FICHIER >/dev/null`). Dans le service, réglez `GATE_AMI_USER`, `GATE_QUEUES` et
`GATE_EXTENSIONS` (files et postes permis), et `GATE_UPSTREAM` si l'étape 1 a montré un préfixe.

```bash
sudo mkdir -p /opt/ami-gate /etc/ami-gate
```

Enregistrez la clé du Worker, lisible par root seulement :

```bash
printf '%s' 'VOTRE_CLÉ' | sudo tee /etc/ami-gate/edge-key >/dev/null && sudo chmod 600 /etc/ami-gate/edge-key
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ami-gate && sudo systemctl status ami-gate --no-pager
```

Attendu : `active (running)` et `ami-gate: listening on 127.0.0.1:8090`. Vérifiez qu'il refuse ce
qui est interdit et laisse passer le reste :

```bash
curl -s -H "X-Edge-Key: $(sudo cat /etc/ami-gate/edge-key)" "http://127.0.0.1:8090/rawman?Action=Command&Command=core+show+version"
```

```bash
curl -s -H "X-Edge-Key: $(sudo cat /etc/ami-gate/edge-key)" "http://127.0.0.1:8090/rawman?Action=Logoff"
```

Attendu : `refused: action not allowed: command`, puis une réponse d'Asterisk (`Response: …`).

## 5. Installer cloudflared (dépôt officiel Cloudflare pour Debian 12)

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

## 6. Créer et configurer le tunnel

Sans `sudo`. La première commande affiche une adresse `https://dash.cloudflare.com/argotunnel?...` :
ouvrez-la dans un navigateur, choisissez votre domaine, **Authorize**.

```bash
cloudflared tunnel login
```

```bash
cloudflared tunnel create shiftline
```

Notez l'**ID du tunnel** affiché, puis créez l'adresse :

```bash
cloudflared tunnel route dns shiftline pbx-api.example.com
```

Déplacez les identifiants dans `/etc/cloudflared` (remplacez `ID_DU_TUNNEL` partout) :

```bash
sudo mkdir -p /etc/cloudflared && sudo cp ~/.cloudflared/ID_DU_TUNNEL.json /etc/cloudflared/ && sudo chmod 600 /etc/cloudflared/ID_DU_TUNNEL.json
```

Seul `/rawman` est transmis, au gardien (port **8090**, jamais directement au 8088 d'Asterisk) ;
tout le reste répond 404 :

```bash
sudo tee /etc/cloudflared/config.yml >/dev/null <<'EOF'
tunnel: ID_DU_TUNNEL
credentials-file: /etc/cloudflared/ID_DU_TUNNEL.json

ingress:
  - hostname: pbx-api.example.com
    path: ^/rawman$
    service: http://127.0.0.1:8090
  - service: http_status:404
EOF
```

Puis :

```bash
sudo cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate
```

Attendu : `OK`.

## 7. Démarrer le tunnel comme service

⚠️ Vérifiez d'abord que la règle de pare-feu Cloudflare existe.

```bash
sudo cloudflared service install
```

```bash
sudo systemctl status cloudflared --no-pager
```

Attendu : `active (running)` et `enabled`.

## 8. Vérifier de l'extérieur

Depuis n'importe quel ordinateur, **sans** la clé (Windows : `curl.exe` et `NUL`) :

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://pbx-api.example.com/rawman?action=Ping"
```

Attendu : `403`, bloqué par Cloudflare. Puis testez dans Slack (README, étape 8).

## Entretien

| Je veux… | Commande |
|---|---|
| Voir ce que le gardien accepte et refuse | `sudo journalctl -u ami-gate -n 50 --no-pager` |
| Ajouter une file ou un poste au gardien | Modifier `GATE_QUEUES` / `GATE_EXTENSIONS`, puis `sudo systemctl daemon-reload && sudo systemctl restart ami-gate` |
| Changer la clé | `/etc/ami-gate/edge-key` + `sudo systemctl restart ami-gate`, la règle de pare-feu, et `npx wrangler secret put PBX_EDGE_KEY`, en même temps |
| Couper l'accès du bot au serveur | `sudo systemctl stop cloudflared` |
| Mettre cloudflared à jour | `sudo apt-get update && sudo apt-get install --only-upgrade cloudflared` |
| Tout retirer | `sudo systemctl disable --now cloudflared ami-gate`, `sudo cloudflared service uninstall`, `cloudflared tunnel delete shiftline` |
