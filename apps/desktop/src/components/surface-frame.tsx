import { useCallback, useRef, useState } from "react";
import { reportStartupProbe } from "../lib/host-api";
import { StartupState } from "./startup-state";

type MainFrameFailure = Event & {
  isMainFrame?: boolean;
  errorCode?: number;
  isInPlace?: boolean;
};
type ReloadableWebview = HTMLElement & { reload(): void };

export function isMainFrameLoadFailure(event: {
  isMainFrame?: boolean;
  errorCode?: number;
}): boolean {
  // Aborted navigation and failed images must not cover an otherwise usable page.
  return event.isMainFrame === true && event.errorCode !== -3;
}

export function SurfaceFrame({
  title,
  description: _description,
  src,
  version,
  preload,
}: {
  title: string;
  description: string;
  src: string | null;
  version: number;
  preload?: string;
}) {
  void _description;
  const [webviewReady, setWebviewReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const previousSource = useRef<string | null>(null);
  const webviewElement = useRef<HTMLElement | null>(null);
  const sourceKey = `${src}:${version}`;
  if (sourceKey !== previousSource.current) {
    previousSource.current = sourceKey;
    if (webviewReady) setWebviewReady(false);
    if (loadFailed) setLoadFailed(false);
  }

  const webviewRefCallback = useCallback(
    (element: HTMLElement | null) => {
      webviewElement.current = element;
      if (!element || !src) return;
      if (preload) element.setAttribute("preload", preload);
      let reportedReady = false;
      let mainDocumentFailed = false;
      const showDocument = () => {
        if (webviewElement.current !== element || mainDocumentFailed) return;
        setWebviewReady(true);
        setLoadFailed(false);
        if (reportedReady) return;
        reportedReady = true;
        try {
          reportStartupProbe({
            source: "renderer",
            stage: "renderer:surface-document-ready",
            status: "ok",
            detail: title,
          });
        } catch {
          // A diagnostic failure must not block a loaded workspace.
        }
      };
      // Show the document when its DOM is ready instead of waiting for every
      // image and other secondary resource. Bind before setting src.
      element.addEventListener("did-start-navigation", (event) => {
        const navigation = event as MainFrameFailure;
        if (
          webviewElement.current !== element ||
          navigation.isMainFrame !== true ||
          navigation.isInPlace
        )
          return;
        mainDocumentFailed = false;
        reportedReady = false;
        setLoadFailed(false);
        setWebviewReady(false);
      });
      element.addEventListener("dom-ready", showDocument);
      element.addEventListener("did-finish-load", showDocument);
      element.addEventListener("did-fail-load", (event) => {
        if (
          webviewElement.current !== element ||
          !isMainFrameLoadFailure(event as MainFrameFailure)
        )
          return;
        mainDocumentFailed = true;
        setLoadFailed(true);
        setWebviewReady(false);
      });
      element.setAttribute("src", src);
    },
    [preload, src, title],
  );

  return (
    <section className="surface-frame" style={{ position: "relative" }}>
      {src && (
        <webview
          ref={webviewRefCallback as React.Ref<HTMLWebViewElement>}
          className="desktop-web-frame"
          key={sourceKey}
          // @ts-expect-error Electron webview boolean attribute must be empty string.
          allowpopups=""
          style={{ opacity: webviewReady ? 1 : 0 }}
        />
      )}
      {(!src || !webviewReady) && (
        <div className="bridge-surface-loading">
          <StartupState
            title={loadFailed ? "工作台暂时未能打开" : "正在打开工作台"}
            description={
              loadFailed
                ? "请检查本地服务，然后重新加载。"
                : "本地服务正在启动，准备好后会自动进入。"
            }
            busy={!loadFailed}
          >
            {loadFailed && (
              <button
                type="button"
                className="bridge-startup-retry"
                onClick={() => {
                  setLoadFailed(false);
                  setWebviewReady(false);
                  (
                    webviewElement.current as ReloadableWebview | null
                  )?.reload();
                }}
              >
                重新加载
              </button>
            )}
          </StartupState>
        </div>
      )}
    </section>
  );
}
