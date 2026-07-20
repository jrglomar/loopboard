Step 1 — get the app running locally
git clone https://github.com/jrglomar/invokeboard.git && cd invokeboard
cp .env.docker.example .env      # fill in real Jira/GitHub creds + TOKEN_ENC_KEY + SESSION_SECRET + ADMIN_EMAILS
docker compose up --build -d
curl -I http://localhost:8080    # confirm the web container answers
Step 2 — create the tunnel in Cloudflare
In dash.cloudflare.com → Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared:

Name it (e.g. invokeboard). Cloudflare gives you a token — copy it.
Add a Public Hostname:
Subdomain/domain: e.g. board.yourdomain.com
Service Type: HTTP, URL: web:80 ← the container name + container port, because cloudflared will run inside the same compose network.
Step 3 — add cloudflared to your compose
Put the token in .env:

CF_TUNNEL_TOKEN=eyJ...your-token...
Then add this service to docker-compose.yml (same network as web, so web:80 resolves):

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run --token ${CF_TUNNEL_TOKEN}
    depends_on:
      - web
    restart: unless-stopped
Step 4 — launch
docker compose up -d
Visit https://board.yourdomain.com — you're live.

What this buys you (and the tightening step)
Free HTTPS, no Caddy/certbot. Cloudflare terminates TLS at its edge, so the browser↔Cloudflare hop is genuinely https — which means the secure session cookie works (the images already bake NODE_ENV=production). You can skip the whole TLS section of DEPLOYMENT.md.
Zero open ports. The tunnel is an outbound connection from cloudflared to Cloudflare — your machine needs no port-forwarding, no public IP, no firewall holes. For the tightest setup, delete the ports: blocks from web, jira, and github in compose entirely: with cloudflared reaching web:80 over the internal network, nothing has to listen on the host at all. (Keep the bridge ports only if you still want curl localhost:4001 for debugging.)
Optional extra gate: Cloudflare Access (Zero Trust → Access → Applications) can require a Google/email login before anyone even reaches the app. The app already has its own login gate, so this is belt-and-suspenders — nice if you want to hide it from the public internet entirely, skippable otherwise.
Try it in 60 seconds first (no domain needed)
Before committing a domain, smoke-test the whole idea with an ephemeral tunnel:

docker run --rm --network invokeboard_default cloudflare/cloudflared:latest \
  tunnel --url http://web:80
It prints a random https://<something>.trycloudflare.com URL that works immediately. Throwaway (dies when you Ctrl-C, not for production), but it proves your stack tunnels correctly before you wire up the real hostname.

Still yours to do: backups. The tunnel changes nothing about storage — run the SQLite/JSON backup from the earlier plan on a cron, kept off-box and apart from .env.

This is genuinely the cheapest good deployment: $0 hosting, free TLS, no exposed ports, and lowest latency since the box sits next to your team. Want me to fold a "Self-host + Cloudflare Tunnel" subsection into docs/DEPLOYMENT.md (the compose snippet + the web:80 gotcha + the drop-the-ports tightening) so it's captured in the repo? Small docs-only commit on the current branch.