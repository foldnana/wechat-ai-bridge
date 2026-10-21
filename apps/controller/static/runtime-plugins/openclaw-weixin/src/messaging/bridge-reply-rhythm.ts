import { setTimeout as delay } from "node:timers/promises";
import type { Behavior } from "../storage/bridge-behavior.js";

/** Only split short prose. Keep structured answers, links and quotations intact. */
export function replyBubbles(
  text: string,
  raw: string,
  config?: Behavior["delivery"],
): string[] {
  if (
    !config || config.mode !== "natural" || text.length > 360 ||
    /```|https?:\/\/|www\.|^\s*(?:[-*#>|]|\d+[.)、])|[“”「」『』"]|\|/m.test(raw)
  ) return [text];
  const sentences = text.match(/[^。！？!?\n]+[。！？!?]*\n*|[。！？!?]+\n*|\n+/g);
  if (!sentences || sentences.join("") !== text) return [text];
  const bubbles: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    current += sentence;
    if (current.trim().length >= 8 && bubbles.length < config.maxBubbles - 1) {
      bubbles.push(current);
      current = "";
    }
  }
  if (current.trim().length < 5 && bubbles.length)
    bubbles[bubbles.length - 1] += current;
  else if (current) bubbles.push(current);
  return bubbles.length ? bubbles : [text];
}

/** Cancellation is rechecked after each wait and before every network send. */
export async function sendReplyBubbles(
  bubbles: string[],
  pauseMs: number,
  send: (text: string) => Promise<unknown>,
  valid: () => boolean,
  signal?: AbortSignal,
): Promise<boolean> {
  for (let i = 0; i < bubbles.length; i++) {
    if (signal?.aborted || !valid()) return false;
    if (i > 0) {
      try {
        await delay(pauseMs, undefined, { signal });
      } catch (error) {
        if (signal?.aborted) return false;
        throw error;
      }
    }
    if (signal?.aborted || !valid()) return false;
    await send(bubbles[i]!);
  }
  return true;
}
