// Relative to process creation, including module loading before this file runs.
const marks = new Map<string, number>();
const stages = new Set([
  "electron main module evaluated",
  "app.whenReady resolved",
  "main window ready-to-show",
  "local-services:listening",
  "workspace:loaded",
  "controller:ready",
  "controller:core-ready",
]);
export function markStartup(stage: string): void {
  if (stages.has(stage) && !marks.has(stage))
    marks.set(stage, Math.round(process.uptime() * 1000));
}
export function getStartupTimings(): Array<{
  stage: string;
  elapsedMs: number;
}> {
  return Array.from(marks, ([stage, elapsedMs]) => ({ stage, elapsedMs }));
}
