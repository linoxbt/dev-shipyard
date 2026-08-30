# Build Runner — architecture and trade-offs

## Why this exists

The App Builder generated apps that ran as ES modules straight in the browser:
an import map, no bundler, no build step. That made preview instant and needed
no infrastructure, but it put a hard ceiling on what the agent could do. It
could not install a dependency, run a linter, typecheck, or drive a browser —
all of which need a filesystem and processes, not an iframe.

This service supplies those. It is the piece that lets the agent say "I
installed it, the build failed with this error, here is the fix" instead of
guessing.

## What changes for the product

Three consequences, all real:

1. **Deployment.** DevStation is static assets plus serverless functions,
   which is cheap and scales to zero. A runner is a stateful, long-lived
   service with a Docker socket. It has to be hosted and paid for, and it
   cannot run on Netlify.

2. **Trust boundary.** Until now DevStation never executed model-written code
   outside a browser sandbox. It now runs it on a machine, with a package
   manager reaching the public registry. That is the substantial part of this
   design — see below.

3. **Preview stops being instant.** A real Vite project must install and build
   before it can be looked at: seconds to a minute, not milliseconds. In
   exchange the output is an ordinary project a developer can clone, extend
   and deploy anywhere.

The no-build path is kept for the fast case. Projects that need real
dependencies use the runner; simple ones still preview instantly.

## Sandboxing

Every job gets its own container, destroyed afterwards.

| Control | Setting | Why |
|---|---|---|
| User | `--user 1000:1000` | Never root, even if the image defaults to it |
| Capabilities | `--cap-drop ALL` | No raw sockets, no mount, no ptrace |
| Escalation | `--security-opt no-new-privileges` | setuid binaries cannot regain root |
| Root filesystem | `--read-only` | The image cannot be modified |
| Writable paths | tmpfs only, `mode=1777` | Nothing survives the job; nothing touches the host |
| Host paths | none mounted | Files arrive over tar on stdin, leave the same way |
| Memory | 1g, swap capped equal | A runaway build is killed, not swapped |
| CPU | 1.0 | One job cannot starve the host |
| Processes | `--pids-limit 256` | Fork bombs |
| Network | **only during `install`** | Built code and tests cannot phone home |
| Time | per-phase and per-job deadlines | Enforced by the runner and by docker |
| Output | log and artifact byte caps | A job cannot flood the response |

The network rule is the one worth stressing. A package manager needs the
registry, so the container is created with the bridge attached and keeps it for
`install`; it is disconnected in a `finally` as soon as the last networked phase
finishes, so every later phase — the build and any test — runs with no route
out. The cut is **one-way**: nothing reattaches it, and asking for a networked
phase afterwards raises rather than silently running without a registry.

**This does not make running untrusted code safe in the absolute sense.** A
container shares the host kernel; a kernel exploit escapes it. What it does is
reduce the blast radius to a disposable container with no host filesystem, no
capabilities and no network. For a stronger boundary the next step is a
VM-isolated runtime (Firecracker, gVisor, or a dedicated throwaway host).

## Notes for whoever maintains this

- **`vite preview` binds `localhost`, which is `::1` here, and Playwright
  polls `127.0.0.1`.** The server starts perfectly and the test suite waits out
  its full sixty-second timeout against the other loopback address, reporting
  only "Timed out waiting from config.webServer". Generated projects pass
  `--host 127.0.0.1` so both sides name the same literal address.
- **Under gVisor, a network cannot be hot-plugged into a running container.**
  The sandbox configures its netstack when it starts, so `docker network
  connect` on a running `runsc` container reports success and changes nothing
  inside: DNS resolves nothing and npm fails with `EAI_AGAIN`. Disconnecting
  works in that direction, which is why the container is created *with* the
  network and loses it once, rather than starting bare and being granted it for
  install. The failure is easy to miss because the warm image already carries
  every dependency a generated project starts with — npm only needs the registry
  when the model *adds* a package, which is exactly the feature the Vite target
  exists for.
- **After the cut, gVisor blocks by timeout rather than `ENETUNREACH`.** Its
  netstack keeps the route and drops the traffic, so a probe hangs for its
  timeout instead of failing instantly. Tests should assert "blocked", not a
  specific errno.
- **A container created with `--network none` can never be given a network.**
  Docker refuses with *"cannot be connected to multiple networks with one of
  the networks in private (none) mode"* — so the obvious shape for this, start
  with nothing and attach the bridge for `install`, does not work. Containers
  are created on the bridge and detached immediately instead, which isolates
  them identically but can be reversed. Docker reports the refusal on stderr
  with a non-zero exit and keeps going, so it is invisible unless the exit code
  is checked: the symptom was every install timing out at three minutes with an
  empty log, because npm was retrying against an unreachable registry.
- **`docker cp` into a tmpfs mount silently does nothing.** It reports success
  and the files are absent. Files are unpacked with `docker exec … tar -x`
  instead, which runs inside the container and writes to the real mount.
- **Every tmpfs docker mounts is `noexec` unless asked otherwise.** The
  workspace has to run binaries — `node_modules/.bin`, and postinstall scripts
  such as esbuild's, which execute the binary they just downloaded — so `/work`
  is mounted with an explicit `exec`. `--mount type=tmpfs` has no option for
  this (`tmpfs-mode` sets permission bits, not mount flags), so the workspace
  uses `--tmpfs` while the others do not. The failure is an EACCES from
  `spawnSync` that names the binary and gives no hint that the mount is the
  cause. `/tmp` stays `noexec` deliberately.
- **A tmpfs is created root-owned.** Without `mode=1777` an unprivileged job
  cannot write to its own workspace, and npm fails with a confusing EACCES.
- The tar reader/writer is ~100 lines rather than a dependency, and its tests
  check it against GNU tar in both directions, because a hand-rolled archive
  format is exactly where an external judge is worth having.

## The image

Node 22, plus two things baked in, both about time rather than convenience:

- **Chromium**, pinned to the Playwright version generated projects depend on.
  Downloading a browser per job would dominate the runtime, and the phases that
  need it have no network to download it with.
- **The dependency set every generated project starts with.** A cold
  `npm install` was measured at **175s against a 180s phase deadline** — jobs
  were failing by seconds. The install phase copies `/opt/warm/node_modules`
  into the workspace first, so npm has only what the model added left to fetch.
  That took install to about 45s. `warm-package.json` mirrors `VITE_DEPS` in
  `src/lib/appgen/generate.ts`, and a test fails if they drift.

Installing also gets a longer deadline than the other phases, because it is the
only one that touches the network and the only one whose cost depends on what
the model asked for.
