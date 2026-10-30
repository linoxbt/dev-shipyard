# Toolchain image for build jobs.
#
# Two things are baked in, and both are about time rather than convenience: a
# job has a hard deadline, and a cold `npm install` of a generated project came
# in at 175s against a 180s limit. Warming the image is what makes the first
# build of an app finish rather than flake.
# Pinned by digest, not just tag: a tag is a pointer anyone with push access
# to it can move, and this image runs every user's build. Bump both together
# (the tag documents which release the digest is).
FROM node:26.12.0-bookworm-slim@sha256:742a0fe7320e09e0321222b68165e6ac731d30470e7ea7f98f9bfc3a6e1034fe

# Chromium's shared libraries, for the Playwright browser installed below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
      libxrandr2 libgbm1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

# Playwright's browser, pinned to the version generated projects depend on.
# Downloading a browser per job would dominate the runtime, and the later
# phases have no network to download it with.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN npx --yes playwright@1.62.1 install chromium \
  && chmod -R a+rX /opt/playwright

# The dependency set every generated project starts with, installed once here
# so a job can copy it into place instead of fetching it. A project that adds a
# package still only downloads the difference, because npm finds the rest
# already present.
#
# Installed from a lockfile with `npm ci`, so the transitive set is the one that
# was reviewed rather than whatever the registry serves on build day. After
# changing warm-package.json, regenerate it from this directory with:
#   cp warm-package.json /tmp/w/package.json && (cd /tmp/w && npm install --package-lock-only)
# and copy /tmp/w/package-lock.json back to warm-package-lock.json.
COPY warm-package.json /opt/warm/package.json
COPY warm-package-lock.json /opt/warm/package-lock.json
RUN cd /opt/warm \
  && npm ci --no-audit --no-fund --loglevel=error \
  && rm -rf /root/.npm \
  && chmod -R a+rX /opt/warm

# Unprivileged. The runner also passes --user, but an image that defaults to
# root is a trap for anyone who runs it another way.
# The base image already has an unprivileged `node` user at uid 1000, so it is
# used by name. (A `useradd -u 1000 ... || true` here used to fail on that uid
# and hide the failure.)
USER node

WORKDIR /work
