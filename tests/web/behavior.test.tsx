import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BehaviorPage } from "../../apps/web/src/pages/behavior";
vi.mock("../../apps/web/src/lib/api", () => ({
  client: { getConfig: () => ({}) },
}));
function render(tab: string, enabled = false) {
  const cache = new QueryClient();
  cache.setQueryData(["bridge-behavior"], {
    proactive: { enabled, channelIds: [] },
  });
  cache.setQueryData(["bridge-stickers"], []);
  cache.setQueryData(["channels"], { channels: [] });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[`/workspace/behavior?tab=${tab}`]}>
        <BehaviorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  cache.clear();
  return html;
}
describe("behavior settings pages", () => {
  it("keeps rhythm settings on a separate page and explains context boundaries", () => {
    const html = render("rhythm");
    expect(html).toContain("短句分条发送");
    expect(html).toContain("长期记忆在「联系人与记忆」中由你填写");
    expect(html).toContain("等你说完再回复");
    expect(html).toContain('value="12000" selected=""');
    expect(html).toContain("无法感知微信正在打字");
    expect(html).not.toContain("让 AI 偶尔先开口");
    expect(html).toContain("无需来回修改设置");
    for (const removed of [
      "回答长短",
      "接着问问题",
      "括号动作与旁白",
      "你喜欢的对话示例",
    ])
      expect(html).not.toContain(removed);
  });
  it("opens delivery controls from old chat links without expression or intent settings", () => {
    const html = render("chat");
    expect(html).toContain("等你说完再回复");
    expect(html).not.toContain("我更希望它");
    expect(html).not.toContain("responseIntent");
    expect(html).not.toContain("可选：长期说话风格");
    expect(html).not.toContain("文字 Emoji");
    expect(html).not.toContain("日常一到三句");
    expect(html).toContain('href="/workspace/preset"');
  });
  it("discloses image upload boundaries and the actual WeChat image format", () => {
    const html = render("stickers");
    expect(html).toContain("图片内容不发送给模型");
    expect(html).toContain("不等同于微信原生收藏表情");
    expect(html).toContain('type="file"');
    expect(html).not.toContain('type="checkbox" checked=""');
  });
  it("does not enable proactive messages by default and shows token and cost limitations", () => {
    const html = render("proactive");
    expect(html).toContain("尚未开启主动聊天");
    expect(html).toContain("会使用你的 API 额度");
    expect(html).toContain("会话凭据可能提前失效");
    expect(html).toContain("先连接微信");
    expect(html).not.toContain('type="checkbox" checked=""');
  });
});
