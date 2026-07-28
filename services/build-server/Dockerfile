# DevStation build server with the full Solana + Anchor toolchain.
# Build:  docker build -t devstation-build-server ./services/build-server
# Run:    docker run -p 8787:8787 -e PUBLIC_URL=https://your-domain devstation-build-server
FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates build-essential pkg-config libssl-dev libudev-dev git \
  && rm -rf /var/lib/apt/lists/*

# Rust — modern stable. Anchor 1.x + current platform-tools are contemporary
# with today's crates.io graph, so no rustc pinning games are needed.
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable

# Solana CLI (Anza) — provides `cargo-build-sbf` + its platform-tools (the SBF
# rustc/std). Agave v4.1.2's cargo-build-sbf ships a modern platform-tools
# (rustc >= 1.85), which Anchor 1.x expects — the target/std layout matches, so a
# plain `anchor build` just works (no `--tools-version` override).
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v4.1.2/install)"
ENV PATH=/root/.local/share/solana/install/active_release/bin:$PATH

# Anchor via avm — CURRENT stable (1.1.2, targets Solana 3.x / modern rustc).
# Using the current Anchor is what makes this whole thing work: the old 0.31.1
# pinned platform-tools v1.43 (Cargo/rustc 1.79, pre-`edition2024`), which cannot
# even PARSE 2026-era transitive deps (edition2024 manifests + rustc >= 1.82/1.85
# MSRVs). Anchor 1.1.2's modern toolchain has none of those problems.
# --from-source is REQUIRED on this base image: a prebuilt anchor binary is linked
# against glibc 2.39 (Ubuntu 24.04) and won't run on node:20-bookworm (glibc 2.36)
# → "GLIBC_2.39 not found" and /health reports toolchain:"missing". Building from
# source links against the local glibc. Slow but cached.
RUN cargo install --git https://github.com/solana-foundation/anchor avm --locked \
  && avm install 1.1.2 --from-source && avm use 1.1.2 \
  && anchor --version

# A dummy keypair so `anchor build` has a provider wallet (build only; never used to sign).
RUN mkdir -p /root/.config/solana && solana-keygen new --no-bip39-passphrase -o /root/.config/solana/id.json

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Pre-warm + BUILD-TIME PROOF: compile the bundled anchor-template with the real
# toolchain. This (1) downloads + caches platform-tools so the first real /build
# request is fast, and (2) FAILS the image build if the toolchain can't actually
# produce a .so — so a successfully-tagged image is a working compiler, not just
# an installed one.
RUN cargo build-sbf --version \
 && cp -r /app/anchor-template /tmp/prewarm \
 && cd /tmp/prewarm \
 && anchor build \
 && test -n "$(ls target/deploy/*.so 2>/dev/null)" \
 && cd /app && rm -rf /tmp/prewarm \
 && echo "platform-tools pre-warmed; template compiled OK"

ENV PORT=8787
EXPOSE 8787
CMD ["node", "src/server.mjs"]
