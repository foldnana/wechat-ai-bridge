import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeferredSurface } from "../../apps/desktop/src/components/deferred-surface";
import { StartupState } from "../../apps/desktop/src/components/startup-state";
import { isMainFrameLoadFailure } from "../../apps/desktop/src/components/surface-frame";

describe("desktop startup surfaces", () => {
  it("does not render unopened control pages or run their components during startup", () => {
    const controlPage = vi.fn(() => (
      <iframe title="Control UI" src="http://127.0.0.1:18789" />
    ));
    const ControlPage = controlPage;
    const html = renderToStaticMarkup(
      <DeferredSurface active={false}>
        <ControlPage />
      </DeferredSurface>,
    );
    expect(html).toBe("");
    expect(controlPage).not.toHaveBeenCalled();
  });

  it("mounts an explicitly opened control surface", () => {
    const html = renderToStaticMarkup(
      <DeferredSurface active>
        <iframe title="Control UI" src="http://127.0.0.1:18789" />
      </DeferredSurface>,
    );
    expect(html).toContain('title="Control UI"');
  });

  it("explains first-run preparation without loading a blocking video", () => {
    const html = renderToStaticMarkup(
      <StartupState
        title="正在准备本地环境"
        description="首次打开需要准备运行文件，完成后会自动进入。"
      />,
    );
    expect(html).toContain("正在准备本地环境");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("<video");
  });

  it("only treats a failed main document as a surface failure", () => {
    expect(
      isMainFrameLoadFailure({ isMainFrame: false, errorCode: -105 }),
    ).toBe(false);
    expect(isMainFrameLoadFailure({ isMainFrame: true, errorCode: -3 })).toBe(
      false,
    );
    expect(isMainFrameLoadFailure({ isMainFrame: true, errorCode: -102 })).toBe(
      true,
    );
  });
});
