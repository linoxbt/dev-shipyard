// Which release asset this machine needs.
//
// Shared by the installer and the launcher so they cannot disagree about the
// name: one of them guessing differently would download a file the other never
// looks for, and the symptom would be a reinstall on every run.

export const TARGETS = {
  "linux-x64": "devstation-linux-x64",
  "linux-arm64": "devstation-linux-arm64",
  "darwin-arm64": "devstation-darwin-arm64",
  "darwin-x64": "devstation-darwin-x64",
  "win32-x64": "devstation-windows-x64.exe",
};

export function targetFor(platform = process.platform, arch = process.arch) {
  return TARGETS[`${platform}-${arch}`] ?? null;
}

/** Where the installed binary lives inside the package. */
export function binaryPath(here, target) {
  return `${here}/${target}`;
}
