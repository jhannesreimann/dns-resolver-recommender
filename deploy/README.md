# Deploy

Configuration and unit files for the Hetzner VM at `dns.diic-hpi.org`.

## Contents

```
nginx/dns.diic-hpi.org.conf   Reverse proxy config (HTTP redirect + HTTPS + /api proxy)
systemd/dnsrr.service         systemd unit for the FastAPI backend
dnsrr.env.example             Template for /etc/dnsrr/dnsrr.env (secrets)
```

## First-time deployment on the VM

Assumes the base packages (`nginx`, `python3`, `python3-venv`, `certbot`,
`python3-certbot-nginx`) are already installed.

1. Create the service user and directories.

   ```bash
   sudo useradd --system --home /opt/dnsrr --shell /usr/sbin/nologin dnsrr
   sudo mkdir -p /opt/dnsrr /var/lib/dnsrr /var/www/dnsrr /etc/dnsrr
   sudo chown -R dnsrr:dnsrr /opt/dnsrr /var/lib/dnsrr
   ```

2. Drop the secrets file in place.

   ```bash
   sudo cp deploy/dnsrr.env.example /etc/dnsrr/dnsrr.env
   sudo chmod 600 /etc/dnsrr/dnsrr.env
   sudo nano /etc/dnsrr/dnsrr.env   # paste real CLOUDFLARE_API_KEY and ZONE_ID
   ```

3. Sync the backend code to the VM and install it inside a venv.

   ```bash
   sudo -u dnsrr python3 -m venv /opt/dnsrr/backend/.venv
   sudo -u dnsrr /opt/dnsrr/backend/.venv/bin/pip install -e /opt/dnsrr/backend
   ```

4. Install the systemd unit and start it.

   ```bash
   sudo cp deploy/systemd/dnsrr.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now dnsrr
   sudo systemctl status dnsrr
   ```

5. Wire up Nginx and request the certificate.

   ```bash
   sudo cp deploy/nginx/dns.diic-hpi.org.conf /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/dns.diic-hpi.org.conf /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d dns.diic-hpi.org \
       --agree-tos -m jhannes.reimann@student.hpi.uni-potsdam.de --no-eff-email
   ```

## Smoke test

```bash
curl -i https://dns.diic-hpi.org/api/health
curl -X POST https://dns.diic-hpi.org/api/dns/rotate
```
