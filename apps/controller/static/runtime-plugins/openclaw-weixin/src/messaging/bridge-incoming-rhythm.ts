/** Local pacing only; never claims to detect typing or understand intent. */
export function incomingWaitMs(text: string, gapMs?: number): number {
  const value = text.trim();
  const unfinished = /[，,、：:…]$/.test(value);
  const complete = /[。！？.!?][”」』"]?$/.test(value) || value.length >= 100;
  const base = unfinished ? 7000 : complete ? 2500 : 4000;
  // Follow the pace of a burst, without letting long gaps delay every reply.
  const observed = gapMs === undefined ? 0 : Math.min(7000, gapMs * 1.25);
  return Math.round(Math.max(base, observed));
}
