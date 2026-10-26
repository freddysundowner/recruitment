# Installing on a server with the scripts (recommended)

Works on Ubuntu and Debian with PostgreSQL 12 or newer (an older one on the server is used as it is; the system is tested on 12 and on 16).

For an ordinary Ubuntu or Debian server (a VPS), two scripts do everything. Copy the whole system folder to the server, then run one of them as root:

```bash
sudo ./install-saas.sh          # the shared service: many agencies sign up and pay you
sudo ./install-standalone.sh    # one agency on its own server (the agency bought it)
```

Both ask a few questions (the domain first, `recruit.reggycodas.com` by default) and then:

1. **Check the server:** root, memory, disk space, a free port. A small server without swap is offered a temporary swap file so the build does not run out of memory.
2. **Give the system its own Node.js** under `/opt/recruit/node`, after checking whether the right version is already there. The server's own Node, and any other system on it, are not touched.
3. **Use the server's PostgreSQL.** It is installed only if there is none. The database and its two users are created only if they do not exist; an existing database is kept as it is.
4. **Build and start:** copy the files, install packages, build, create the tables, and run the website and the background worker as services (`recruit-<domain>-web` and `-worker`) under their own user, restarting by themselves.
5. **nginx:** it looks for an existing `server_name` for the domain. If there is one it leaves it alone (and tells you what to point it at); otherwise it adds the server block, with the right headers and a 12 MB upload limit. nginx is installed only if missing.
6. **SSL:** if the domain already has a certificate, none is requested. If not, and DNS points at the server, it gets a free Let's Encrypt certificate with certbot and turns on renewal. If DNS is not ready yet it tells you the one command to run later.
7. **Backups and updates:** a nightly backup of the database and documents (14 days kept) in `/var/backups/recruit/<domain>`, and the `recruit-update` command.
8. **Check:** it confirms the website answers, then prints what to do next.

You can run an installer again at any time. It keeps your secrets, database, documents and any settings you added to the settings file (`/etc/recruit/<domain>.env`). Several installs, such as one shared service and one single-agency copy on different domains, can live on the same server; each gets its own database, folder, port and services.

**For no questions at all**, give the answers as options: `sudo ./install-saas.sh --yes --domain recruit.example.com --email me@example.com --admin-email me@example.com` (with `PLATFORM_ADMIN_PASSWORD` in the environment). `./install-saas.sh --help` lists every option. If your PostgreSQL is on another machine, set `PG_ADMIN_URL`.

**Copy `FIELD_ENCRYPTION_KEY`** from `/etc/recruit/<domain>.env` to your password manager when it finishes. Without it, ID and passport numbers cannot be read again.

## Updating

Upload the new files (a folder, or a `.tar.gz` or `.zip`) to the server and run:

```bash
sudo recruit-update /path/to/the/new/files      # add --check first to see what would change
```

`update.js` shows what will change, backs up the database, builds the new version next to the running one (the website stays up while it builds), stops the services for about half a minute to update the tables and swap, then checks the site answers. If anything fails it puts the old version back, and the old data too if it has to. Your settings, documents and database are never replaced. `sudo recruit-update --rollback` goes back to the previous version.

## Removing an install

`sudo ./uninstall.sh` removes the services, the nginx site and (only if you say yes to each) the files, the database and the settings. It never touches PostgreSQL itself, nginx, or other systems.

---

# Installing with Docker instead

This guide is for putting the system on a server you control: a single agency running its own copy, or you running the shared multi-agency service. You need a Linux server (2 GB of memory is enough to start), a domain name pointing at it, and Docker with the Compose plugin.

## 1. Get the files and make your settings

```bash
git clone <your copy of the code> recruitment && cd recruitment/app
cp .env.prod.example .env.prod
```

Open `.env.prod` and fill in at least:

| Setting | What to put |
| --- | --- |
| `ADMIN_DB_PASSWORD`, `APP_DB_PASSWORD` | Two different long passwords. Make them up and save them in your password manager. |
| `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY` | Run `openssl rand -hex 32` twice and paste one into each. **Back up `FIELD_ENCRYPTION_KEY`.** If it is lost, ID and passport numbers cannot be read again. |
| `APP_URL` | The address people will use, for example `https://recruit.youragency.co.ke` (no slash at the end). |

**Single-agency install (you bought the system):** also set `TENANT_MODE=single` and paste the `LICENSE_PUBLIC_KEY` you were given. Keep the activation key for step 4.

**Shared multi-agency service (you sell it to other agencies):** leave `TENANT_MODE` empty and fill in the M-Pesa and card sections so agencies can pay you.

## 2. Start it

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d db
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d app worker
```

The first command starts the database. The second creates the tables. The third starts the website and the background worker (which sends messages and reminders and checks M-Pesa payments).

## 3. Put it behind HTTPS

The app listens on port 3000. Put a web server in front of it that handles the certificate. With Caddy, which gets certificates by itself, `/etc/caddy/Caddyfile` is just:

```
recruit.youragency.co.ke {
    reverse_proxy localhost:3000
}
```

Every page, and especially sign-in, must be served over HTTPS. M-Pesa will only send payment confirmations to an `https://` address that is reachable from the internet, so `APP_URL` must be that address.

## 4. First sign-in

- **Single install:** open your address. You are taken to a setup page. Paste the activation key, enter your agency's name and your own details, and you are in. Then go to **Settings** to add your team and add your M-Pesa details.
- **Shared service:** create the first platform administrator, then sign in at `/platform/login`:

  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
    -e PLATFORM_ADMIN_PASSWORD='a long password of 12 or more characters' \
    --entrypoint npx migrate tsx scripts/create-platform-admin.ts you@example.com "Your Name"
  ```

  Agencies sign themselves up at `/signup`.

## 5. Backups (do this on day one)

```bash
./scripts/backup.sh          # database + uploaded documents, into ./backups
```

Run it every night from `cron` and copy the `backups` folder to another machine or storage account. A backup that lives only on the same server will not help if the server is lost. To practise a restore on a spare machine: `./scripts/restore.sh backups/db-<date>.dump`.

Also keep a copy of `.env.prod` somewhere safe. Without `FIELD_ENCRYPTION_KEY` a restored database cannot show ID numbers.

## 6. Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d app worker
```

Take a backup first. Migrations only add to the database and never delete your data.

## Optional pieces

- **SMS, email and WhatsApp:** SMS goes through BlessedTexts and email through Brevo. On a single install, fill in `BLESSEDTEXTS_API_KEY`, `BREVO_API_KEY`, `EMAIL_FROM` and the `WHATSAPP_*` settings. On the shared service, sign in to `/platform` and fill them in under **Settings** instead. Until you do, messages are recorded but not delivered, and the Messages sections say so. On the shared service each agency starts with 20 free SMS credits and buys more by M-Pesa; the price per credit is also under Settings.
- **Your own document storage (MinIO):** set `STORAGE_DRIVER=s3`, `S3_ENDPOINT=http://minio:9000`, `S3_FORCE_PATH_STYLE=true`, `S3_BUCKET`, and the access key and secret, then add `--profile minio` to the `up` command.
- **Virus scanning of uploads:** set `CLAMAV_HOST=clamav` and add `--profile clamav`. Add `CLAMAV_REQUIRED=true` to pause uploads whenever the scanner is down.
- **Agency addresses such as `acme.yourapp.co.ke` (shared service):** set `APP_DOMAIN=yourapp.co.ke` and point a wildcard DNS record `*.yourapp.co.ke` and a wildcard certificate at the server.

## Safaricom M-Pesa

Each agency adds its own paybill or till and Daraja keys under **Settings**. In `sandbox` mode nothing real is charged. Moving to `production` needs a Safaricom go-live approval for that paybill. The callback address is created for you from `APP_URL` and contains a secret that is different for every request.

## If something looks wrong

- `docker compose -f docker-compose.prod.yml logs app worker` shows what the app and worker are doing.
- Messages sit in the system as "queued" if the worker is not running: check `docker compose ps`.
- After an update, if a page shows a database error mentioning a "cached plan", restart the app: `docker compose restart app worker`.
