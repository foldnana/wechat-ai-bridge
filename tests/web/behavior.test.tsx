import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { chatRecipes } from "../../apps/web/src/lib/bridge-chat-recipes";
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
  it("offers recipes without overwriting user identity, examples or outreach permission", () => {
    for (const recipe of chatRecipes) {
      const before = {
        persona: "none",
        examples: "我的示例",
        proactive: { enabled: false },
        stickers: { enabled: false },
      };
      expect({ ...before, ...recipe.settings }).toMatchObject(before);
      expect(render("chat")).toContain(recipe.name);
    }
  });
  it("keeps rhythm settings on a separate page and explains context boundaries", () => {
    const html = render("rhythm");
    expect(html).toContain("短句分条发送");
    expect(html).toContain("少追问，允许自然结束");
    expect(html).toContain("本次不额外建立长期记忆");
    expect(html).not.toContain("让 AI 偶尔先开口");
  });
  it("separates model preferences from enforced delivery rules", () => {
    const html = render("chat");
    expect(html).toContain("自然随和");
    expect(html).toContain("实际表达由当前模型决定");
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
