# The image the coding agent's commands run inside.
#
# Deliberately not the same image as services/runner/Dockerfile. That one is
# built for the app-generation pipeline: node, npm and a Chromium for Playwright,
# with a warm node_modules baked in. This one has to be able to build and test
# whatever project somebody points the agent at, which is a different job.
#
# What is here, and what is not. node, bun, python3, git and Foundry cover the
# large majority of what people open an agent on, and git is here because a project's
# own tooling reaches for it even though the agent's checkpoints run on the
# host. Rust and Go are deliberately absent: each would add roughly a gigabyte
# for a case better served by pointing DEVSTATION_SANDBOX_IMAGE at an image that
# already has them. The capability probe in sandbox-exec.ts says so by name
# rather than letting it surface as `cargo: not found` mid-run.
#
# Build:  bun run sandbox:image
# Pinned by digest, the same base as services/runner/Dockerfile: the moving
# `22` tag let a rebuild silently change the toolchain every agent command runs
# on. Bump the tag and digest together; Dependabot proposes them.
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94

# ca-certificates so https works during an install; the rest is what a build
# script reaches for often enough to be worth the layer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip git python3 python3-pip ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Bun, at an exact version, into a location on the default PATH. Copied from the
# official image rather than piped from `curl https://bun.sh/install | bash`,
# which installed whatever Bun was newest at build time with nothing checking
# what was downloaded: a mutable input into the image that runs model-written
# commands. Keep this in step with BUN_VERSION in .github/workflows/ci.yml.
ARG BUN_VERSION=1.4.2
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
  && test "$(bun --version)" = "$BUN_VERSION"

# Foundry (forge, cast, anvil), for smart contract work: compiling, testing,
# deploying through the agent's onchain tool, and a local chain with anvil.
# Copied from the official image at an exact release, for the same reason as
# Bun above: nothing piped from an install script.
COPY --from=ghcr.io/foundry-rs/foundry:v1.8.6 /usr/local/bin/forge /usr/local/bin/forge
COPY --from=ghcr.io/foundry-rs/foundry:v1.8.6 /usr/local/bin/cast /usr/local/bin/cast
COPY --from=ghcr.io/foundry-rs/foundry:v1.8.6 /usr/local/bin/anvil /usr/local/bin/anvil
RUN forge --version && cast --version

# No USER line, on purpose.
#
# The workspace is bind-mounted from the host and the container is run with
# --user <host uid>:<host gid> so that files it writes are owned by the person
# who owns the project. That uid will usually not exist in this image, so
# nothing here may depend on a named user or on a home directory existing:
# HOME is set to /tmp at run time, which is a tmpfs the sandbox provides.
WORKDIR /work

# Never actually used: the sandbox always supplies `sleep <deadline>` as the
# command. Here so that `docker run` on this image by hand does something
# harmless and obvious rather than exiting instantly.
CMD ["sleep", "60"]
