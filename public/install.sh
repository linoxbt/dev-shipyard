#!/bin/sh
set -eu

# DevStation installer.
#
#   curl -fsSL https://devstation.online/install.sh | sh
#
# Fetches the standalone binary for this machine. It carries its own runtime,
# so nothing needs to be installed first, which is the whole point of shipping
# it this way rather than only on npm.
#
# POSIX sh on purpose: this runs before anything is installed, and assuming
# bash is how an installer fails on Alpine and on a fresh macOS.

REPO="${DEVSTATION_REPO:-linoxbt/dev-shipyard}"
VERSION="${DEVSTATION_VERSION:-latest}"
INSTALL_DIR="${DEVSTATION_INSTALL_DIR:-$HOME/.devstation/bin}"
# Set to a directory or file:// URL to install from a local build instead.
SOURCE="${DEVSTATION_SOURCE:-}"

say() { printf '%s\n' "$*"; }
die() {
  printf 'devstation: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "this needs $1, which is not installed."
}

detect_target() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Linux) os_part="linux" ;;
    Darwin) os_part="darwin" ;;
    MINGW* | MSYS* | CYGWIN*) die "on Windows, use: npm install -g devstation" ;;
    *) die "unsupported system: $os" ;;
  esac
  case "$arch" in
    x86_64 | amd64) arch_part="x64" ;;
    arm64 | aarch64) arch_part="arm64" ;;
    *) die "unsupported processor: $arch" ;;
  esac
  printf 'devstation-%s-%s' "$os_part" "$arch_part"
}

main() {
  need uname
  target=$(detect_target)
  tmp=$(mktemp -d)
  # Whatever happens next, do not leave a half-downloaded binary behind.
  trap 'rm -rf "$tmp"' EXIT INT TERM

  if [ -n "$SOURCE" ]; then
    say "Installing $target from $SOURCE"
    cp "${SOURCE%/}/$target" "$tmp/devstation" || die "no $target in $SOURCE"
  else
    need curl
    if [ "$VERSION" = "latest" ]; then
      url="https://github.com/$REPO/releases/latest/download/$target"
    else
      url="https://github.com/$REPO/releases/download/$VERSION/$target"
    fi
    say "Downloading $target"
    # -f so a 404 is a failure rather than an HTML page saved as a binary,
    # which is the classic way an installer produces "cannot execute".
    curl -fsSL "$url" -o "$tmp/devstation" ||
      die "could not download $url
Check that a release exists, or install with: npm install -g devstation"
  fi

  chmod +x "$tmp/devstation"

  # Run it before putting it on the PATH: a binary for the wrong architecture
  # should fail here, with an explanation, not the first time it is used.
  "$tmp/devstation" --version >/dev/null 2>&1 ||
    die "the downloaded binary does not run on this machine."

  mkdir -p "$INSTALL_DIR"
  mv "$tmp/devstation" "$INSTALL_DIR/devstation"

  version=$("$INSTALL_DIR/devstation" --version)
  say ""
  say "Installed $version to $INSTALL_DIR/devstation"

  case ":$PATH:" in
    *":$INSTALL_DIR:"*)
      say ""
      say "Run: devstation"
      ;;
    *)
      say ""
      say "$INSTALL_DIR is not on your PATH. Add it:"
      say ""
      say "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.profile"
      say "  export PATH=\"$INSTALL_DIR:\$PATH\""
      say ""
      say "Then run: devstation"
      ;;
  esac
  say ""
  say "It needs a model key first: ANTHROPIC_API_KEY, or OPENROUTER_API_KEY."
  say "Check with: devstation doctor"
}

main "$@"
