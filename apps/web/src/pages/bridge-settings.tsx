import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  getApiInternalDesktopDefaultModel,
  getApiV1BridgePreset,
  getApiV1Sessions,
  postApiV1BridgeModel,
  postApiV1BridgeSessionsByIdNew,
  putApiV1BridgePreset,
} from "../../lib/api/sdk.gen";

export function BridgeSettingsPage() {
  const cache = useQueryClient();
  const [provider, setProvider] = useState<"deepseek" | "custom-openai">(
    "deepseek",
  );
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("deepseek-chat");
  const [baseUrl, setBaseUrl] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const selected = useQuery({
    queryKey: ["desktop-default-model"],
    queryFn: async () =>
      (await getApiInternalDesktopDefaultModel({ throwOnError: true })).data,
  });
  const preset = useQuery({
    queryKey: ["bridge-preset"],
    queryFn: async () =>
      (await getApiV1BridgePreset({ throwOnError: true })).data,
  });
  const test = useMutation({
    mutationFn: async () =>
      (
        await postApiV1BridgeModel({
          body: {
            provider,
            apiKey,
            model,
            ...(provider === "custom-openai" ? { baseUrl } : {}),
          },
          signal: AbortSignal.timeout(120_000),
          throwOnError: true,
        })
      ).data,
    onSuccess: (result) => {
      if (result?.saved) {
        setApiKey("");
        void cache.invalidateQueries({ queryKey: ["desktop-default-model"] });
        void cache.invalidateQueries({ queryKey: ["models"] });
      }
    },
  });
  const savePreset = useMutation({
    mutationFn: async () => {
      await putApiV1BridgePreset({
        body: { preset: draft ?? preset.data?.preset ?? "" },
        throwOnError: true,
      });
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["bridge-preset"] });
    },
  });
  const sessions = useQuery({
    queryKey: ["bridge-sessions"],
    queryFn: async () =>
      (await getApiV1Sessions({ query: { limit: 100 }, throwOnError: true }))
        .data,
  });
  const resetSession = useMutation({
    mutationFn: async (id: string) =>
      (
        await postApiV1BridgeSessionsByIdNew({
          path: { id },
          throwOnError: true,
        })
      ).data,
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["bridge-sessions"] });
    },
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h2 className="text-2xl font-semibold">API 与 AI 设置</h2>
      <p>填写自己的 API，测试通过后会自动保存并选中模型。</p>
      {selected.data?.modelId && (
        <p>
          已保存模型：{selected.data.modelId}。无需重新填写，
          <Link className="text-accent underline" to="/workspace">
            继续微信连接
          </Link>
          。
        </p>
      )}
      <form
        className="space-y-4 rounded-xl border border-border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          test.mutate();
        }}
      >
        <fieldset
          disabled={test.isPending}
          className="space-y-4 disabled:opacity-60"
        >
          <p className="font-medium">
            {provider === "deepseek" ? "DeepSeek（默认）" : "自定义兼容接口"}
          </p>
          <label className="block">
            API Key
            <input
              type="password"
              autoComplete="off"
              required
              maxLength={4096}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                test.reset();
              }}
              className="mt-2 block w-full rounded border border-border bg-surface-1 p-3"
              placeholder="在模型服务商处购买并创建的 API Key"
            />
          </label>
          <details>
            <summary className="cursor-pointer text-accent">
              高级设置：其他接口、模型名称
            </summary>
            <div className="mt-3 space-y-3">
              <label className="block">
                接口类型
                <select
                  value={provider}
                  onChange={(event) => {
                    setProvider(event.target.value as typeof provider);
                    test.reset();
                  }}
                  className="ml-3 rounded border border-border bg-surface-1 p-2"
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="custom-openai">OpenAI 兼容接口</option>
                </select>
              </label>
              {provider === "custom-openai" && (
                <label className="block">
                  接口基础地址
                  <input
                    type="url"
                    required
                    value={baseUrl}
                    onChange={(event) => {
                      setBaseUrl(event.target.value);
                      test.reset();
                    }}
                    placeholder="https://example.com/v1"
                    className="mt-2 block w-full rounded border border-border bg-surface-1 p-3"
                  />
                  <span className="text-sm text-text-secondary">
                    不要填写 /chat/completions；密钥将发送到你填写的地址。
                  </span>
                </label>
              )}
              <label className="block">
                模型名称
                <input
                  required
                  maxLength={200}
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value);
                    test.reset();
                  }}
                  className="mt-2 block w-full rounded border border-border bg-surface-1 p-3"
                />
              </label>
              <Link
                to="/workspace/models/advanced?tab=providers"
                className="text-accent underline"
              >
                其他协议及已有供应商管理
              </Link>
            </div>
          </details>
          <p className="text-sm text-text-secondary">
            测试会发送一条简短请求，产生少量 API
            用量。测试失败不会替换已保存的模型。
          </p>
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 text-white"
          >
            {test.isPending ? "正在测试并保存，请稍候…" : "测试并保存模型"}
          </button>
        </fieldset>
        {test.data && (
          <output className={test.data.ok ? "text-green-700" : "text-red-600"}>
            {test.data.message}
          </output>
        )}
        {test.isError && (
          <p role="alert" className="text-red-600">
            本地服务没有及时完成请求。请刷新检查已保存模型，再决定是否重试。
          </p>
        )}
        {test.data?.saved && (
          <Link className="block text-accent underline" to="/workspace">
            下一步：微信扫码
          </Link>
        )}
      </form>
      <section className="space-y-3 rounded-xl border border-border p-5">
        <h3 className="font-medium">你自己的 AI 预设</h3>
        <p className="text-sm">
          填写回答风格、称呼或要求。保存后从下一次回复开始加载；已有对话上下文仍会保留。留空保存可取消预设。
        </p>
        {preset.isError ? (
          <button
            type="button"
            onClick={() => void preset.refetch()}
            className="underline"
          >
            预设读取失败，点击重试
          </button>
        ) : (
          <>
            <textarea
              aria-label="AI 预设"
              rows={6}
              maxLength={16000}
              disabled={preset.isPending || savePreset.isPending}
              value={draft ?? preset.data?.preset ?? ""}
              onChange={(event) => {
                setDraft(event.target.value);
                savePreset.reset();
              }}
              className="block w-full rounded border border-border bg-surface-1 p-3"
              placeholder="例如：用简洁的中文回答，先给结论，再解释。"
            />
            <button
              type="button"
              disabled={preset.isPending || savePreset.isPending}
              onClick={() => savePreset.mutate()}
              className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-40"
            >
              保存预设
            </button>
          </>
        )}
        {savePreset.isSuccess && (
          <output className="block">预设已保存。</output>
        )}
        {savePreset.isError && (
          <p role="alert">保存或同步失败，请检查本地服务后重试。</p>
        )}
      </section>
      <section className="space-y-3 rounded-xl border border-border p-5">
        <h3 className="font-medium">新开对话</h3>
        <p className="text-sm">
          为选定的微信会话重新开始上下文，保留你的预设。旧本机记录不会删除，也不会删除手机上的微信记录。
        </p>
        <button
          type="button"
          onClick={() => void sessions.refetch()}
          className="underline"
        >
          刷新最近对话
        </button>
        {sessions.isError && <p role="alert">读取失败，请检查本地服务。</p>}
        {!sessions.isPending &&
          !sessions.isError &&
          !sessions.data?.sessions.some((item) =>
            ["wechat", "openclaw-weixin"].includes(item.channelType ?? ""),
          ) && <p>尚无微信会话，请先在微信发送消息，再刷新。</p>}
        {sessions.data?.sessions
          .filter((item) =>
            ["wechat", "openclaw-weixin"].includes(item.channelType ?? ""),
          )
          .map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between gap-3 rounded border border-border p-3"
            >
              <span className="truncate">{session.title || "微信对话"}</span>
              <button
                type="button"
                className="shrink-0 underline"
                disabled={resetSession.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "为这个微信会话新开对话？下次回复将不再携带旧上下文，预设保留。",
                    )
                  )
                    resetSession.mutate(session.id);
                }}
              >
                新开对话
              </button>
            </div>
          ))}
        {resetSession.data && (
          <output className="block">{resetSession.data.message}</output>
        )}
        {resetSession.isError && (
          <p role="alert">操作未能完成，请检查本地服务后重试。</p>
        )}
      </section>
    </div>
  );
}
