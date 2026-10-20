# Filmnacht

Self-hosted movie nights for small groups, with a fair draw.

## Run with Docker

You need Docker with the Compose plugin and a reverse proxy that serves HTTPS
(Caddy, nginx, Traefik, …).

```sh
mkdir filmnacht && cd filmnacht
curl -O https://raw.githubusercontent.com/xFuture603/filmnacht/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/xFuture603/filmnacht/main/.env.example
# edit .env, see "Configuration" below
docker compose up -d
```

Open your address in the browser. The first visit shows the setup page, which
makes the first account the instance admin.

The app listens on `127.0.0.1:3000` only, so nothing reaches it except your
reverse proxy on the same machine. To use another port, set `FILMNACHT_PORT` in
`.env`.

## Configuration

Everything is set in `.env`; `.env.example` explains each value.

| Setting                                                         | Needed         | What it does                                                                                                                         |
| --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ORIGIN`                                                        | yes            | The public address, e.g. `https://filmnacht.example.org`. Compose will not start without.                                            |
| `ADDRESS_HEADER`, `XFF_DEPTH`                                   | behind a proxy | Lets the login rate limit tell visitors apart. See below.                                                                            |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | no             | Password-reset, draw, rating and calendar emails. Without them the admin can still create a recovery link for a locked-out member.   |
| `TMDB_API_KEY`                                                  | no             | Film search with posters. Without it films are added by hand. Free key at [themoviedb.org](https://www.themoviedb.org/settings/api). |
| `FILMNACHT_IMAGE`                                               | no             | Pin a version, e.g. `ghcr.io/xfuture603/filmnacht:0.1.0`. Default: `latest`.                                                         |

After changing `.env`, run `docker compose up -d` again.

## Behind a reverse proxy

- Forward your HTTPS address to `http://127.0.0.1:3000`.
- Set `ORIGIN` to the address exactly as it appears in the browser, with no
  trailing slash. If they differ, every form is refused and each page says
  "This page is open at …, but Filmnacht is set up for …".
- Set these two, or every visitor looks like the proxy and one person guessing
  passwords locks the whole group out of logging in:

  ```sh
  ADDRESS_HEADER=x-forwarded-for
  XFF_DEPTH=1   # the number of proxies in front of Filmnacht
  ```

  Set them only when a proxy is really in front. Otherwise visitors can fake
  their address and get around the limit.

- A proxy running in Docker can reach the container over a shared Docker
  network instead of the published port.

## Updating

```sh
docker compose pull
docker compose up -d
```

Database changes run on startup. Before applying one, Filmnacht copies the
database to `filmnacht.db.pre-<version>.bak` in the same volume.

Versions follow [semantic versioning](https://semver.org). `latest` always
points to the newest release; pin `FILMNACHT_IMAGE` to a version if you prefer to
update on your own schedule. Release notes are on the
[releases page](https://github.com/xFuture603/filmnacht/releases).

## Backup and restore

All data lives in one Docker volume (`filmnacht-data`, prefixed with your project
folder name). Back it up regularly and keep the copies somewhere other than the
server. Stop the app for the copy so the database is consistent; it takes a few
seconds.

```sh
# back up
docker compose stop
docker run --rm --volumes-from "$(docker compose ps -aq filmnacht)" -v "$PWD:/backup" \
  alpine tar czf "/backup/filmnacht-$(date +%F).tar.gz" -C /data .
docker compose start
```

```sh
# restore (replaces everything in the volume)
docker compose stop
docker run --rm --volumes-from "$(docker compose ps -aq filmnacht)" -v "$PWD:/backup" \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/filmnacht-2026-10-20.tar.gz -C /data'
docker compose start
```

The volume must be on local disk. SQLite's locking is not safe over NFS or SMB.

## Images

Images are published to `ghcr.io/xfuture603/filmnacht` for amd64 and arm64,
signed with cosign, and come with an SBOM and build provenance. They run as a
non-root user on a read-only file system, as set in `compose.yaml`.

To check a signature (needs cosign 3 or newer):

```sh
cosign verify ghcr.io/xfuture603/filmnacht:0.1.0 \
  --certificate-identity-regexp '^https://github.com/xFuture603/filmnacht/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Develop

```sh
cp .env.example .env
npm install
npm run dev
```

Before pushing, run `npm run lint`, `npm run check`, `npm test` and `npm run build`.

## License

[MIT](LICENSE)
