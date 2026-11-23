# PhD site template

A personal website for a computer science PhD student, plus everything needed to keep it current without touching the site's code:

- **The website**: home, publications, projects, demos, talks, teaching, news and custom pages. Rendered on the server, so it is fast, works without JavaScript, and is readable by search engines and Google Scholar.
- **An admin console** at `/admin`: edit your profile, post news, import BibTeX, upload files, manage demos, and undo any change.
- **A REST API** behind the console, so you can update the site from scripts, CI, or the included command-line tool.
- **Demo hosting for your tools**: let visitors try what you build, right on your site.

There is nothing to install beyond Node.js 20.11 or newer: no `npm install`, no build step, no database.

```bash
npm start
```

Open http://localhost:3000 for the site and http://localhost:3000/admin for the console. On first start the server creates `data/` with example content and prints an admin password once. Change it under **Account**, or run `npm run site -- set-password`.

---

## Updating the site

| You want to… | In the admin | From the terminal |
| --- | --- | --- |
| Post news | Overview → Post a news item | `npm run site -- news "Paper accepted!"` |
| Add publications | Publications → Import BibTeX | `npm run site -- bibtex papers.bib` |
| Publish a browser demo | Demos → (demo) → Upload a folder | `npm run site -- push-demo my-tool ./dist` |
| Change your photo, bio, CV | Profile | |
| Change link color, home sections, navigation | Site settings | |
| Undo a mistake | History and backups → Restore | `npm run site -- restore backup.json` |

The terminal commands talk to a running site through its API. Log in once with `npm run site -- login --url https://your.site`. The token is saved in `~/.config/phd-site/credentials.json`; in CI, set `SITE_URL` and `SITE_TOKEN` instead.

Changes show up on the site immediately. Every save keeps the previous version (the last 50 are listed under **History and backups**).

## Demos for your developer tools

Each demo gets its own page at `/demos/<address>`. Link it from a publication or project and that entry shows a **Try the demo** link. Pick one in **Site settings → Demo on the home page** to put it right under your name.

There are three kinds:

### 1. In the visitor's browser (static)

For tools that compile to the web: a JavaScript bundle, WebAssembly (Emscripten, wasm-pack), Pyodide, or a plain HTML page. Upload the folder your build produces (it must contain `index.html`), either with **Upload a folder** in the admin or:

```bash
npm run site -- push-demo shapeshift ./dist --title "Shapeshift"
```

Files are served from `/d/<address>/` with a sandbox policy, so a demo's scripts cannot read your admin session even though they run on your domain. If a demo needs `localStorage`, cookies or a service worker, untick **Sandbox the demo** (only for code you trust).

The example **Shapeshift** demo (`seed/demos/shapeshift/`) is a single HTML file that infers TypeScript types from JSON.

### 2. On this server (playground)

For command-line tools: linters, analyzers, compilers, transformers. Visitors type or paste input, pick one of the options you defined, and press **Run**. The server runs your tool's Docker image and shows its output.

Every run happens in a fresh container with:

- no network access,
- a read-only filesystem (only a 64 MB `/tmp` is writable),
- an unprivileged user and no Linux capabilities,
- memory, CPU, process-count and time limits you set per demo,
- `--pull never`, so only images already on the server can run.

Visitors only control the input (on stdin) and which preset to use. They can never change the image, the command or the arguments. Runs are also rate-limited per visitor (30 every 10 minutes by default), capped at 2 at a time, and inputs are limited to 100 KB. Change these with the `RUN_*` settings in `.env.example`.

Try the included example, a small Python linter:

```bash
docker build -t phd-site-example-linter examples/linter-demo
```

Then open `/demos/tidylint`. To demo your own tool, build an image that contains it and create a playground demo:

- **Docker image**: e.g. `ghcr.io/you/tool:1.2` (use **Download image from registry** in the admin to pull it).
- **Command**: what goes after the image name in `docker run`. Input arrives on stdin. If your tool wants a file, write `{input}` where the path goes: `mytool --check {input}`. Set **Input file name** so the file gets the right extension. (This mode needs `sh` in the image.)
- **Options visitors can pick**: each adds arguments at `{args}` in the command, or at the end.
- **Example inputs**: the first is loaded when the page opens.

Use **Try it** on the demo's admin page to test it exactly as visitors will.

If your tool needs a GPU or lives elsewhere, set **Runs with** to *An HTTP endpoint you host elsewhere*. The site forwards `POST {"input", "args"}` to it and shows the response (`{"stdout", "stderr", "exitCode"}` or plain text). The endpoint and its token are never sent to visitors.

No Docker? Playground demos say they can't run, and everything else keeps working. To preview the playground UI without Docker, use the stand-in: `DOCKER_BIN=tools/fake-docker.js npm start`.

### 3. Somewhere else (embed)

Paste the address of a Hugging Face Space, Streamlit app, StackBlitz project, YouTube video or asciinema recording.

## Customizing

- **Colors and type**: the link color is a setting. Everything else is in `site/assets/site.css`; the design tokens are at the top.
- **Layout**: the page templates are plain functions in `site/render.js`. Values are HTML-escaped automatically, so content can never inject markup.
- **New fields or content types**: add them to `server/schema.js`. The API validates against it and the admin console builds its forms from it, so a new field appears in the console with no other change. Then show it in `site/render.js`.

## Deploying

The site is one Node process plus the `data/` folder. Pick one:

**A small Linux server (recommended for playground demos).** Install Node and Docker, copy the repository to `/srv/phd-site`, create `.env` (set `PUBLIC_URL` and `HOST=127.0.0.1`), and use `deploy/phd-site.service` (systemd) with `deploy/Caddyfile` (automatic HTTPS). Add the service user to the `docker` group for playgrounds.

**Docker Compose.** `docker compose up -d`. To enable playground demos, uncomment the Docker socket line in `docker-compose.yml`. That gives the site container control of the host's Docker, so only do it on a machine dedicated to the site.

**GitHub Pages (static).** `npm run export` writes a static copy to `dist/`. Browser and embedded demos work; playground demos need a live server (pass `--api-url https://your.server` to run them there). `deploy/github-pages.yml` publishes automatically on push; read the comment at its top first.

Behind a reverse proxy, set `TRUST_PROXY=true` so rate limits see real visitor addresses.

## Your data

```
data/
  content.json   all text and settings (human-readable; safe to edit by hand while the server is stopped)
  media/         uploaded files, served at /media/
  demos/<slug>/  browser demo files, served at /d/<slug>/
  backups/       the previous 50 versions of content.json
  auth.json      admin password hash   ← secret
  secret.key     session signing key   ← secret
```

Back up the whole folder. `data/.gitignore` keeps the secrets out of git if you decide to commit the rest.

## API

All admin endpoints need `Authorization: Bearer <token>` from `POST /api/auth/login`.

| Method and path | What it does |
| --- | --- |
| `POST /api/auth/login` `{password}` | Returns `{token, expiresAt}` (7 days; 90 with `"client": "cli"`) |
| `GET /api/schema` | Field definitions for every content type |
| `GET` / `PUT /api/content` | Read or replace everything (validated; previous version backed up) |
| `GET` / `PUT /api/profile`, `/api/settings` | Read or replace one section |
| `GET` / `POST /api/collections/:name` | List or create items (`news`, `publications`, `projects`, `demos`, `talks`, `teaching`, `pages`) |
| `GET` / `PUT` / `DELETE /api/collections/:name/:id` | Read, replace or delete an item |
| `POST /api/collections/:name/reorder` `{ids}` | Set the order |
| `POST /api/collections/:name/:id/duplicate` | Copy an item |
| `POST /api/publications/import-bibtex` `{bibtex, dryRun}` | Import BibTeX, skipping duplicates |
| `GET` / `PUT` / `DELETE /api/media/:name` | List, upload (raw body) or delete files |
| `GET` / `PUT` / `DELETE /api/demos/:slug/files/*` | Manage a browser demo's files |
| `GET /api/runner`, `GET /api/demos/:slug/image`, `POST …/image/pull` | Docker status and images |
| `GET /api/backups`, `POST /api/backups/:name/restore` | History |
| `POST /api/demos/:slug/run` `{input, preset}` | **Public.** Run a playground demo |
| `GET /api/public/content` | **Public.** All content minus private fields, for building your own frontend |

Validation errors come back as `422 {"error", "fields": {"path.to.field": "message"}}`.

## Project layout

```
server/   API, auth, storage, schema, sandboxed demo runner
site/     page templates, theme CSS, static export
admin/    the admin console (plain ES modules, no build)
shared/   Markdown renderer used by both the site and the console
bin/      command-line tool
seed/     example content copied into data/ on first start
examples/ example playground tool and its Dockerfile
deploy/   systemd, Caddy and GitHub Pages configs
tools/    fake-docker.js, a Docker stand-in for tests and local previews
```

`npm test` runs the test suite (Node's built-in runner, no Docker needed). `npm run dev` restarts the server when server code changes.
