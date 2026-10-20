import type { DesktopBuildInfo, DesktopBuildSource } from "./runtime-config";

export type DesktopUpdateExperience =
  | "normal"
  | "local-validation"
  | "local-test-feed";

export function resolveDesktopUpdateExperience(input: {
  buildSource: DesktopBuildSource;
  updateFeed: string | null;
}): DesktopUpdateExperience {
  if (input.buildSource !== "local-dist") {
    return "normal";
  }

  return input.updateFeed ? "local-test-feed" : "local-validation";
}
export function shouldEnableDesktopUpdateManager(_input: {
  buildSource: DesktopBuildSource;
  updateFeed: string | null;
}): boolean {
  return false;
}
export function shouldStartDesktopPeriodicUpdateChecks(_input: {
  buildSource: DesktopBuildSource;
  updateFeed: string | null;
}): boolean {
  return false;
}

export function getDesktopUpdateTestingGuideUrl(
  buildInfo: Pick<DesktopBuildInfo, "commit">,
): string {
  const ref = buildInfo.commit ?? "main";
  return `https://github.com/nexu-io/nexu/blob/${ref}/specs/guides/desktop-update-testing.md`;
}
