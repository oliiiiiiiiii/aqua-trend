# Container deployment

The repository and pinned GitHub Release assets are public. Deployment requirements and implementation gaps are defined in [`SPEC.md` §7](../SPEC.md#7-公開-repo-部署規格). This guide describes commands supported by the current code; it does not establish a hosting provider or automatic deployment.

The image runs the Next.js standalone server with Node.js 24 on port 8080. It serves `/detective/`, `/explore/`, `POST /api/select-variables/`, and the public dataset. The default container uses keyword selection immediately; no model, model download, Python service, or API key is required.

The runtime runs as UID/GID `1000:1000`. Compose keeps its filesystem read-only, with writable temporary mounts at `/tmp` and `/app/.next/cache`. Compiled application files, required Node dependencies, and public data are included in the image. The data setup marker `public/data/.bundle` is excluded from the served output.

## Build on a new host

Install Git, Node.js 24 with npm, curl, tar, and Docker with Compose. Start the Docker engine. Clone over HTTPS and prepare the pinned public data on the host. The commands stop at the first failure:

```sh
git clone https://github.com/oliiiiiiiiii/aqua-trend.git &&
cd aqua-trend/web &&
npm ci &&
AQUA_DATA_URL="$(node -p "const d = require('./data.lock.json'); 'https://github.com/' + d.repo + '/releases/download/' + d.tag + '/' + d.asset")" &&
AQUA_DATA_FILE="$(mktemp "${TMPDIR:-/tmp}/aqua-data.XXXXXX")" &&
curl --fail --location --retry 3 "$AQUA_DATA_URL" --output "$AQUA_DATA_FILE" &&
npm run setup -- --file "$AQUA_DATA_FILE" &&
rm -f "$AQUA_DATA_FILE" &&
cd .. &&
docker compose up --build -d
```

This flow needs no GitHub login, SSH key, `gh`, or token. The URL comes from `web/data.lock.json`; `setup --file` verifies SHA-256 before replacing and extracting `web/data` and `web/public/data`. For a release deployment, check out the intended commit before preparing the data and record that SHA. A failed download or setup can leave the temporary archive for inspection; remove it after resolving the failure.

**Current implementation gap:** `npm run setup` without `--file` still selects the GitHub CLI or a token-based API path. Public visibility alone does not change that script. Use the anonymous download above until the automatic public-download requirement in the SPEC is implemented. The Dockerfile requires prepared data in its build context; a bare `docker compose up --build` on an empty checkout cannot bootstrap it.

If you already have the pinned archive, skip the download and prepare it from `web/` with:

```sh
npm run setup -- --file /absolute/path/to/aqua-trend-data-v2.tar.gz
```

Open <http://localhost:8080/detective/>. To change only the published host port, use `PORT=8090 docker compose up --build -d`; the server still listens on 8080 inside the container. Ports are published on the host's network interfaces. Put HTTPS and request limits at a reverse proxy or hosting platform for public deployment.

The Docker build checks the bundle marker against the lockfile and verifies the preprocessing inputs before building. Missing, stale, or incomplete data stops the build with setup instructions. The browser's generated `data/gen` is rebuilt inside the image. `.dockerignore` allows only website inputs and required deployment scripts; it excludes environment files, secrets, Git history, dependencies, local build outputs, raw repository datasets, and duplicate files. Update this allowlist when adding a new top-level website source directory or config file.

## Check the running service

```sh
docker compose ps
curl --fail http://localhost:8080/healthz/
curl --fail http://localhost:8080/data/gen/catalog.json -o /dev/null
curl --fail http://localhost:8080/data/catalog/variables.json -o /dev/null
curl --fail http://localhost:8080/api/select-variables/ \
  -H 'Content-Type: application/json' \
  -d '{"event":"2022 Pakistan floods"}'
curl -I http://localhost:8080/detective/
curl -I http://localhost:8080/this-route-does-not-exist/
curl -I http://localhost:8080/data/.bundle
docker compose logs --tail=100 web
```

Expected results are `ok` from health, successful data and page responses, 17 category votes with `source: "keyword-fallback"` from the default API, and HTTP 404 for the unknown route and `.bundle`. Invalid API input returns HTTP 400. The healthcheck probes `/healthz/` every 30 seconds; it checks the web server without requiring an optional model service.

Next.js retains `trailingSlash: true`: `/detective`, `/healthz`, and `/api/select-variables` redirect to their slash-ending paths. Use the trailing slash when posting to the API, or use a client that follows the HTTP 308 redirect while preserving the method and body. Hashed Next.js assets receive immutable caching; public data uses Next.js public-file caching with `max-age=0`.

## Optional selector backends

Selector settings are runtime environment variables. Compose reads them from the shell or the repository-root `.env`; it does not read `web/.env.local`. Copy the example if you want a local configuration file:

```sh
cp deploy/.env.example .env
# Edit .env, then recreate the service with those runtime settings.
docker compose up -d
```

The root `.env` is ignored by Git and excluded from the build context. Set API keys there or in the deployment platform's runtime secret environment, never in a Dockerfile, build argument, or `NEXT_PUBLIC_` variable. Changing selector settings requires recreating the container, not rebuilding the image.

| Variable | Container default | Purpose |
| --- | --- | --- |
| `SELECTOR_BACKEND` | `keyword` | `keyword`, `local`, `openai`, or `systemone` |
| `SELECTOR_URL` | `http://host.docker.internal:8770` | Base URL of the optional local selector's `/select` service; an explicit empty value disables it |
| `SELECTOR_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `SELECTOR_OPENAI_MODEL` | empty | Model name required by the `openai` backend |
| `SELECTOR_SYSTEMONE_URL` | empty | Full `/v1/systemone` endpoint required by the `systemone` backend |
| `SELECTOR_SYSTEMONE_MODEL` | empty | Optional model name for the `systemone` backend |
| `SELECTOR_API_KEY` | empty | Optional bearer credential sent only by the server to the selected online backend |
| `SELECTOR_ONLINE_TIMEOUT_MS` | `5000` | Online deadline in milliseconds, capped at 5000 by the application |

The development server defaults to `local`; this container explicitly defaults to `keyword`. Model errors, invalid responses, or a missed deadline fall back to keywords. `source` is `local-model` or `online-model` only when that backend returns valid probabilities. Remote backends receive the user's event text.

For an OpenAI-compatible service, set `SELECTOR_BACKEND=openai`, `SELECTOR_OPENAI_BASE_URL`, `SELECTOR_OPENAI_MODEL`, and any required `SELECTOR_API_KEY`. For a remotely hosted OneJev/qev service, use `SELECTOR_BACKEND=systemone` and the full `SELECTOR_SYSTEMONE_URL`. Actual model quality and availability depend on that separately operated service; the website image does not install it.

For the optional OneJev service on the Docker host, follow the separate installation and model instructions in [`tools/selector/README.md`](../tools/selector/README.md), then start it with a bind address containers can reach:

```sh
SELECTOR_HOST=0.0.0.0 ONEJEV_GGUF=/absolute/path/to/model.gguf \
  tools/selector/start-onejev.sh
```

In another terminal, from the repository root:

```sh
SELECTOR_BACKEND=local \
SELECTOR_URL=http://host.docker.internal:8770 \
docker compose up -d
```

Compose maps `host.docker.internal` to Docker's host gateway, including on Linux. Container `127.0.0.1` refers to the container itself. A host selector bound only to `127.0.0.1` is not reachable through the Linux bridge, so the example binds the selector to all host interfaces; restrict port 8770 to the Docker network or use a specific reachable bind address. The model server can remain on host loopback. For a selector in another container on the same Compose network, use its service name, for example `SELECTOR_URL=http://selector:8770`, and bind that service to `0.0.0.0` inside its container. These networking rules follow [Docker's Compose networking guidance](https://docs.docker.com/compose/how-tos/networking/).

## Update, move, and stop

After changing code, rebuild. If `web/data.lock.json` changed, repeat the public download and `setup --file` preparation using the new lockfile first:

```sh
docker compose up --build -d
```

Stop and remove the service with `docker compose down`. Public data is baked into the image, so there is no runtime data volume to initialize or preserve. Temporary caches disappear when the container is recreated. If future changes add ISR or other persistent writes, revisit the read-only filesystem and cache configuration.

For a registry deployment, build and push from a prepared checkout:

```sh
docker build -t YOUR_REGISTRY/aqua-trend:YOUR_TAG .
docker push YOUR_REGISTRY/aqua-trend:YOUR_TAG
```

The destination host needs Docker and the built image; it does not need Node.js, source data setup, GitHub credentials, or model files for keyword mode. Run the image on container port 8080, preserving the Compose runtime settings. Configure the image as publicly readable when publishing the public distribution; pushing it still requires registry write permission. `YOUR_REGISTRY` and `YOUR_TAG` are placeholders, and no published registry image is established by these examples. Build for the destination architecture when needed, for example `docker buildx build --platform linux/amd64 -t YOUR_REGISTRY/aqua-trend:YOUR_TAG --push .`. Keep the previous image digest for rollback.

For a local production run without Docker, run `npm run build` and `npm start` from `web`. The postbuild script prepares `.next/standalone` with public and Next.js static assets; `npm start` starts that packaged server. Set `HOSTNAME=0.0.0.0 PORT=8080 SELECTOR_BACKEND=keyword` to match the container's network and selector settings.

The configuration follows the installed Next.js [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) and [self-hosting](https://nextjs.org/docs/app/guides/self-hosting) guides. Both image stages use `node:24-alpine`; the tag can receive updates. Use reviewed digest pins if deployment requires identical base-image bytes across builds.
