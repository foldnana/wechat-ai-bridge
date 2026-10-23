import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ActivityPage } from "../../apps/web/src/pages/activity";
import { BridgeSettingsPage } from "../../apps/web/src/pages/bridge-settings";

function renderPage(page: ReactNode, seed: (client: QueryClient) => void) {
  const client = new QueryClient();
  seed(client);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}

describe("separate workspace pages", () => {
  it("shows the DeepSeek default without filling or saving a custom preset", () => {
    const html = renderPage(
      <BridgeSettingsPage section="preset" />,
      (client) => {
        client.setQueryData(["desktop-default-model"], {
          modelId: "deepseek/deepseek-chat",
        });
        client.setQueryData(["bridge-behavior"], { persona: "auto" });
        client.setQueryData(["bridge-preset"], { preset: "" });
      },
    );
    expect(html).toContain("大肥鱼已就位");
    expect(html).toContain("编辑大肥鱼预设");
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
  });
  it("keeps custom text and distinguishes it from the fallback persona", () => {
    const html = renderPage(
      <BridgeSettingsPage section="preset" />,
      (client) => {
        client.setQueryData(["desktop-default-model"], {
          modelId: "deepseek/deepseek-chat",
        });
        client.setQueryData(["bridge-behavior"], { persona: "auto" });
        client.setQueryData(["bridge-preset"], { preset: "只用商务语气。" });
      },
    );
    expect(html).toContain("只用商务语气。");
    expect(html).toContain("自定义内容保存后优先使用");
    expect(html).not.toContain("编辑大肥鱼预设");
    expect(html).not.toContain("大肥鱼已就位");
  });
  it("limits sessions to four WeChat conversations per page", () => {
    const html = renderPage(
      <BridgeSettingsPage section="sessions" />,
      (client) => {
        client.setQueryData(["bridge-sessions"], {
          sessions: [
            { id: "other", channelType: "slack", title: "Excluded channel" },
            ...Array.from({ length: 7 }, (_, i) => ({
              id: `${i}`,
              channelType: "wechat",
              title: `Conversation ${i}`,
            })),
          ],
        });
      },
    );
    expect(html).toContain("Conversation 3");
    expect(html).not.toContain("Conversation 4");
    expect(html).not.toContain("Excluded channel");
    expect(html).toContain("1 / 2");
    expect(html).not.toContain("测试并保存模型");
  });
  it("keeps a saved model's next step on the dedicated authorization route", () => {
    const html = renderPage(
      <BridgeSettingsPage section="model" />,
      (client) => {
        client.setQueryData(["desktop-default-model"], {
          modelId: "deepseek/deepseek-chat",
        });
      },
    );
    expect(html).toContain('href="/workspace/wechat"');
    expect(html).toContain("下一步：连接微信");
    expect(html).not.toContain("保存预设");
  });
  it("shows two activity records and distinguishes accepted sends from actual delivery", () => {
    const html = renderPage(<ActivityPage />, (client) => {
      client.setQueryData(["bridge-activity"], {
        activities: Array.from({ length: 3 }, (_, i) => ({
          channelId: `channel-${i}`,
          activity: {
            receivedAt: Date.now(),
            generatedAt: Date.now(),
            sentAt: i === 0 ? Date.now() : null,
            error: i === 1 ? "generation" : null,
          },
        })),
      });
    });
    expect((html.match(/class="bridge-record"/g) ?? []).length).toBe(2);
    expect(html).toContain("微信接受发送");
    expect(html).toContain("实际回复请在手机上查看");
    expect(html).toContain('href="/workspace/models"');
    expect(html).toContain("1 / 2");
  });
  it("reports activity read errors without presenting cached success", () => {
    const html = renderPage(<ActivityPage />, (client) => {
      client.setQueryData(["bridge-activity"], {
        activities: [
          {
            channelId: "saved",
            activity: { receivedAt: Date.now(), sentAt: Date.now() },
          },
        ],
      });
      client
        .getQueryCache()
        .find({ queryKey: ["bridge-activity"] })
        ?.setState({ status: "error", error: new Error("Unavailable") });
    });
    expect(html).toContain("暂时无法读取记录");
    expect(html).not.toContain('class="bridge-record"');
  });
  it("distinguishes cancelled replies and optional sticker warnings from delivery errors", () => {
    const html = renderPage(<ActivityPage />, (client) => {
      client.setQueryData(["bridge-activity"], {
        activities: [
          {
            channelId: "sticker",
            activity: {
              receivedAt: Date.now(),
              sentAt: Date.now(),
              error: null,
              warning: "sticker",
            },
          },
          {
            channelId: "cancel",
            activity: {
              receivedAt: Date.now(),
              sentAt: null,
              error: null,
              cancelled: true,
            },
          },
        ],
      });
    });
    expect(html).toContain("已停止");
    expect(html).toContain("回答已发送，附带表情未发出");
    expect(html).not.toContain("发送失败，请检查微信授权");
    expect(html).not.toContain(">处理中<");
  });
});
