# DevStation Build Runner

Runs a generated project's real toolchain: `npm install`, lint, `vite build`,
Playwright, and returns the logs and the built output.

This exists because the App Builder previously could not do any of that. A
generated app ran as ES modules straight in the browser, which made preview
instant but meant "install dependencies", "run the linter" and "test it in a
browser" were impossible: they need a filesystem and processes, not an iframe.

## The threat model

The input is **code written by a language model on a user's behalf**. Treat
every job as hostile:

- Each job runs in its own container, created and destroyed per job.
- Non-root, all capabilities dropped, no privilege escalation.
- Read-only root filesystem; the only writable paths are tmpfs mounts.
- No host path is ever mounted. Files arrive in the request body and leave in
  the response.
- Memory, CPU, process count and output size are capped, and every job has a
  hard wall-clock timeout enforced by the runner as well as by Docker.
- Network is available during `install` (a package manager needs a registry)
  and **disabled** for every other phase, so built code cannot phone home.

None of this makes running untrusted code safe in an absolute sense. It makes
the blast radius a disposable container with no host access, which is the
realistic bar.

## API

    GET  /health                      -> { ok, docker, image, runtime, active, queued }
    POST /jobs   { files, phases }    -> { ok, phases: [...], dist }

    GET  /                            -> dashboard (session cookie)
    GET  /login   POST /login         -> sign in
    POST /logout                      -> sign out
    GET  /api/stats                   -> snapshot the dashboard polls

Bearer token required on `/jobs` (`RUNNER_TOKEN`); the dashboard routes use a
session cookie from `DASHBOARD_PASSWORD` and can never reach `/jobs`.

Phases are `install`, `lint`, `typecheck`, `build`, `test`, run in the order
given and stopped at the first failure: later phases would fail for the same
reason and the logs get harder to read, not easier. Each is reported
separately, so a lint failure is distinguishable from a build failure.

DevStation never calls this directly. The browser talks to `/api/build`, which
holds the token server-side and rate limits; set `RUNNER_URL` and
`RUNNER_TOKEN` there. With neither set, the App Builder falls back to
generating apps that run with no build step at all.

## Dashboard

`https://backend.devstation.online` serves a read-only view of the service:
isolation runtime, live queue depth, host memory/disk/load, and the last 200
builds with per-phase timings and log tails. It polls `/api/stats` every five
seconds. One self-contained HTML document, no build step, no CDN, because
something you open when things are going wrong should not depend on a bundler
or somebody else's network.

`DASHBOARD_PASSWORD` gates it, and it is **deliberately a different credential
from `RUNNER_TOKEN`**. That token authorises `POST /jobs`, which runs code; a
dashboard is a browser surface with cookies, and giving it the same authority
would turn any leaked viewing session into code execution. A dashboard session
is not a token, and the job route accepts only a token.

Unset the password and the dashboard is **off**, not open: the routes 404.

History lives in `$RUNNER_STATE_DIR/history.json` (systemd provides
`/var/lib/devstation-runner`), written atomically via a temp file and rename so
a crash mid-write cannot corrupt it. Losing history never fails a build.

## Isolation runtime

Jobs run under **gVisor** (`runsc`), not plain `runc`. gVisor services syscalls
in user space, so a Linux kernel bug in model-written code is no longer one hop
from the host, which matters here because this runs beside other projects and
their secrets rather than on a throwaway machine.

It costs speed, and the cost is not small. Measured on the deployment host,
same job, warm image:

| phase | runc | runsc | |
|---|---|---|---|
| install | 43s | 138s | 3.2x |
| lint | 6s | 10s | 1.6x |
| build | 22s | 29s | 1.4x |
| test | 22s | 43s | 1.9x |

`npm install` suffers most because it is almost pure syscall. The phase and job
deadlines in `limits.ts` are sized for those numbers.

`RUNNER_RUNTIME=runc` opts out and roughly halves build times, at the cost of
the isolation. The default is `runsc` on purpose: a host without gVisor fails
loudly at container creation rather than quietly running with less protection.

Install gVisor with the instructions at <https://gvisor.dev/docs/user_guide/install/>,
register it as a Docker runtime, and apply with `kill -HUP $(pgrep -x dockerd)`
rather than a restart if the host runs other containers: a SIGHUP reload picks
up new `runtimes` without stopping anything.

## Running it

    docker build -t devstation-runner:3 services/runner
    RUNNER_TOKEN=... RUNNER_IMAGE=devstation-runner:3 bun services/runner/src/server.ts

The image build is slow (a browser and a warm dependency tree) and worth it -
see ARCHITECTURE.md. A typical job runs install → lint → build → test in about
100 seconds.

## Tests

    bun run test:runner

Kept out of `bun run test` on purpose. These drive real Docker and take about
four minutes, most of it one test that waits out a phase deadline. They skip
themselves when there is no daemon or the image has not been built.

They cover the isolation claims above rather than the HTTP layer, because those
claims are the reason this service may run model-written code at all, and each
of them has already been wrong once in a way that a typecheck, a lint and a
review all missed.
