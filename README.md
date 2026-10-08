# Filmnacht

Self-hosted movie nights for small groups, with a fair draw.

## Run with Docker

```sh
curl -O https://raw.githubusercontent.com/xFuture603/filmnacht/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/xFuture603/filmnacht/main/.env.example
# edit .env: set ORIGIN to the address people type, e.g. https://filmnacht.example.org
docker compose up -d
```

The app listens on `127.0.0.1:3000` only. Put a reverse proxy with HTTPS in front
of it. The first visit opens the setup page. Data lives in the `filmnacht-data`
volume, which must be on local disk. Everything else you can set is described in
`.env.example`.

### Hosting behind a Reverse Proxy

- Set `ORIGIN` to the public address exactly as it appears in the browser, e.g.
  `https://filmnacht.example.org`, with no trailing slash.
- If the page shows "This page is open at …, but Filmnacht is set up for …", the two
  differ and every form will be refused. Fix `ORIGIN` and run `docker compose up -d`.
- A proxy running in Docker can reach the container over a shared network instead
  of the published port.

Images are published to `ghcr.io/xfuture603/filmnacht` for amd64 and arm64 and
signed with cosign. To pin a version, set `FILMNACHT_IMAGE=ghcr.io/xfuture603/filmnacht:1.2.3`.

## Develop

```sh
cp .env.example .env
npm install
npm run dev
```

Before pushing, run `npm run lint`, `npm run check`, `npm test` and `npm run build`.
