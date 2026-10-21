import type { ReactNode } from "react";

export function StartupState({
  title,
  description,
  busy = true,
  children,
}: {
  title: string;
  description: string;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      className="bridge-startup-state"
      aria-live="polite"
      aria-busy={busy}
    >
      <div
        className={busy ? "bridge-startup-mark is-busy" : "bridge-startup-mark"}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 40 40"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M7 28V15a7 7 0 0 1 14 0v10a4 4 0 0 0 8 0V12"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className="bridge-startup-brand">Bridge</span>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </section>
  );
}
