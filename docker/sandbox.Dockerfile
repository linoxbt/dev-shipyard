# The image the coding agent's commands run inside.
#
# Deliberately not the same image as services/runner/Dockerfile. That one is
# built for the app-generation pipeline: node, npm and a Chromium for Playwright,
# with a warm node_modules baked in. This one has to be able to build and test
# whatever project somebody points the agent at, which is a different job.
#
# What is here, and what is not. node, bun, python3 and git cover the large
# majority of what people open an agent on, and git is here because a project's
# own tooling reaches for it even though the agent's checkpoints run on the
# host. Rust and Go are deliberately absent: each would add roughly a gigabyte
# for a case better served by pointing DEVSTATION_SANDBOX_IMAGE at an image that
# already has them. The capability probe in sandbox-exec.ts says so by name
# rather than letting it surface as `cargo: not found` mid-run.
#
# Build:  bun run sandbox:image
FROM node:22-bookworm-slim

# ca-certificates so https works during an install; the rest is what a build
# script reaches for often enough to be worth the layer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip git python3 python3-pip ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Bun, into a location on the default PATH. Installed by hand rather than from
# the oven image so node and bun are both present in one image.
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash \
  && bun --version

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
