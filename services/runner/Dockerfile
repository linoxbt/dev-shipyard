# Toolchain image for build jobs.
#
# Two things are baked in, and both are about time rather than convenience: a
# job has a hard deadline, and a cold `npm install` of a generated project came
# in at 175s against a 180s limit. Warming the image is what makes the first
# build of an app finish rather than flake.
FROM node:22-bookworm-slim

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
COPY warm-package.json /opt/warm/package.json
RUN cd /opt/warm \
  && npm install --no-audit --no-fund --loglevel=error \
  && rm -rf /root/.npm \
  && chmod -R a+rX /opt/warm

# Unprivileged. The runner also passes --user, but an image that defaults to
# root is a trap for anyone who runs it another way.
RUN useradd -m -u 1000 runner || true
USER 1000:1000
WORKDIR /work
