// Where the runner keeps everything that has to survive a restart.
//
// There used to be two names for this. Jobs and history read RUNNER_STATE_DIR;
// accounts, listings and marketplace activity read systemd's STATE_DIRECTORY.
// Setting only the documented one moved half the state and left the rest in
// /var/lib, so a host migration could quietly lose every linked account. One
// helper, one answer: RUNNER_STATE_DIR wins, STATE_DIRECTORY (what systemd's
// StateDirectory= sets) is honoured for hosts that already rely on it.

export const DEFAULT_STATE_DIR = "/var/lib/devstation-runner";

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.RUNNER_STATE_DIR || env.STATE_DIRECTORY || DEFAULT_STATE_DIR;
}
