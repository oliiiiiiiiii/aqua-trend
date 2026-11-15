# Container deployment

The image builds the current Next.js static export with Node 24 and serves it with nginx on port 8080. The runtime runs as UID/GID `101:101`; it contains the exported website and public data, without Node.js, source files, or GitHub credentials. Compose uses a read-only filesystem with temporary nginx files in `/tmp`.

## Prepare the data and start

Install Docker with Compose and start its engine. Data preparation also needs Node.js 24 and npm on the host. From the repository root:

```sh
cd web
npm ci
npm run setup
cd ..
docker compose up --build -d
```

`npm run setup` downloads the private GitHub Release bundle pinned by `web/data.lock.json`, verifies its SHA-256, and extracts `web/data` and `web/public/data`. Authenticate the host's GitHub CLI with access to the repository, or supply `GITHUB_TOKEN` to the host setup command. Credentials are not passed to Docker.

To use an already downloaded bundle, replace `npm run setup` with:

```sh
npm run setup -- --file /absolute/path/to/aqua-trend-data-v0.tar.gz
```

Open <http://localhost:8080>. Use another host port with `PORT=8090 docker compose up --build -d`; nginx still listens on 8080 inside the container. Ports are published on the host's network interfaces. For a public deployment, put HTTPS at the reverse proxy or hosting platform in front of this HTTP service.

The build requires the bundle marker to match the lockfile and the preprocessing inputs to exist. Missing, stale, or incomplete data stops the build with setup instructions. `.dockerignore` includes the website's source data, excludes generated `public/data/gen`, and keeps raw repository datasets, credentials, Git history, dependencies, build outputs, and duplicate files out of the context. The browser data is regenerated during the build. When adding a new top-level website source directory or config file, update this allowlist too.

## Check and operate

```sh
docker compose ps
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8080/data/gen/catalog.json -o /dev/null
curl -I http://localhost:8080/explore/
curl -I http://localhost:8080/this-route-does-not-exist
docker compose logs --tail=100 web
```

Expected responses are `ok`, successful data and page responses, and HTTP 404 for the unknown route. The image healthcheck probes `/healthz` every 30 seconds. `/explore` redirects to `/explore/`, including when a different host port or reverse proxy is used. Unknown routes and missing data/assets return 404. Hashed `/_next/static/` assets get a one-year immutable cache; HTML, navigation payloads, and data revalidate on each request.

After changing code or the data lockfile, run setup again if the pinned bundle changed, then rebuild:

```sh
docker compose up --build -d
```

Stop and remove the container with `docker compose down`. Website data is baked into the image, so there is no runtime data volume to initialize or preserve. Publishing an image also publishes its exported public dataset; keep the image registry private if that dataset must remain private.

For a registry-based deployment, build and tag from the prepared checkout:

```sh
docker build -t YOUR_REGISTRY/aqua-trend:YOUR_TAG .
docker push YOUR_REGISTRY/aqua-trend:YOUR_TAG
```

Run that image on port 8080 with a writable `/tmp`; the Compose file shows the filesystem and capability settings. Build for the deployment machine's architecture when it differs from the build host, for example `docker buildx build --platform linux/amd64 -t YOUR_REGISTRY/aqua-trend:YOUR_TAG --push .`. Keep a previous image tag for rollback.

## Current scope

- `/explore/` is available in this build.
- `/dev/detective-chart/` previews the merged chart components with explicitly labeled fake data. It is a development preview.
- The full `/detective/` interface from workstream C has not been integrated and is not a deployment acceptance target yet.
- This image has no dynamic API server. Integrating workstream D's request-time API will require a Node.js server deployment or a separate backend, plus an update to the static-export configuration and container design.

The runtime uses the [NGINX unprivileged image](https://github.com/nginx/docker-nginx-unprivileged), with nginx `1.30.6` pinned. The build uses the [official Node 24 Alpine image](https://hub.docker.com/_/node). Tags can receive base-image updates; use reviewed digest pins if a deployment requires identical base-image bytes on every build. The routing follows [Next.js static-export hosting](https://nextjs.org/docs/app/guides/static-exports) and nginx's [`try_files` behavior](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files).
