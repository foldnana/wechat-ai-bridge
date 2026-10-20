import { MessageCircle, Sparkles } from "lucide-react";
import { useId } from "react";
import { BridgeMark } from "./bridge-mark";

/** Decorative connection illustration. Connection health is shown separately. */
export function ConnectionScene() {
  const gradientId = useId();
  return (
    <div className="connection-scene" aria-hidden="true">
      <div className="scene-aura" />
      <div className="scene-orbit scene-orbit-outer" />
      <div className="scene-orbit scene-orbit-inner" />
      <svg
        className="scene-wires"
        viewBox="0 0 440 280"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="70" y1="0" x2="370" y2="0">
            <stop stopColor="var(--bridge-line)" />
            <stop offset=".5" stopColor="var(--bridge-green)" />
            <stop offset="1" stopColor="var(--bridge-line)" />
          </linearGradient>
        </defs>
        <path
          className="scene-wire-track"
          d="M90 132C145 132 147 112 220 140S299 148 350 132"
        />
        <path
          className="scene-wire-flow"
          d="M90 132C145 132 147 112 220 140S299 148 350 132"
          stroke={`url(#${gradientId})`}
        />
        <path
          className="scene-wire-secondary"
          d="M90 152C153 220 291 220 350 152"
        />
      </svg>
      <div className="scene-node scene-node-ai">
        <div className="scene-tile">
          <Sparkles size={34} strokeWidth={1.5} />
        </div>
        <span>YOUR AI</span>
      </div>
      <div className="scene-center">
        <BridgeMark />
      </div>
      <div className="scene-node scene-node-wechat">
        <div className="scene-tile">
          <MessageCircle size={36} strokeWidth={1.6} />
        </div>
        <span>YOUR WECHAT</span>
      </div>
      <span className="scene-spark scene-spark-one" />
      <span className="scene-spark scene-spark-two" />
      <span className="scene-caption">灵感与日常，从此相连</span>
    </div>
  );
}
