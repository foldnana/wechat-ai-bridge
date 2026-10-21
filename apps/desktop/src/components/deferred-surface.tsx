import { type ReactNode, useEffect, useState } from "react";

/** Unopened diagnostic surfaces must not load a webview or start background work. */
export function DeferredSurface({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  if (!active && !visited) return null;
  return (
    <div style={{ display: active ? "contents" : "none" }}>{children}</div>
  );
}
