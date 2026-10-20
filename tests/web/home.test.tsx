import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceLayout } from "../../apps/web/src/layouts/workspace-layout";
import { HomePage } from "../../apps/web/src/pages/home";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
function renderHome(modelId: string | null) {
  const client = new QueryClient();
  client.setQueryData(["desktop-default-model"], { modelId });
  client.setQueryData(["channels"], { channels: [] });
  client.setQueryData(["models"], {
    models: modelId
      ? [{ id: modelId, name: modelId, provider: "deepseek" }]
      : [],
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}
describe("local bridge setup", () => {
  it("requires a selected model before starting QR authorization", () => {
    const html = renderHome(null);
    expect(html).toContain("尚未选择模型");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("cloud-connect");
  });
  it("offers QR authorization after choosing a user model", () => {
    const html = renderHome("deepseek/deepseek-chat");
    expect(html).toContain("deepseek/deepseek-chat");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("电脑需要保持开机");
  });
  it("exposes only the connection and model navigation", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <WorkspaceLayout />
      </MemoryRouter>,
    );
    expect(html).toContain("微信连接");
    expect(html).toContain("API 与模型");
    expect(html).not.toMatch(/rewards|skills|integrations|登录/);
  });
});
