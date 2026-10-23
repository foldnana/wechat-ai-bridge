import { WHALE_PERSONA, isDeepSeekModel } from "@nexu/shared/bridge-persona";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  getApiInternalDesktopDefaultModel,
  getApiV1BridgeBehavior,
  getApiV1BridgeModelsSaved,
  getApiV1BridgePreset,
  getApiV1Sessions,
  postApiV1BridgeModel,
  postApiV1BridgeSessionsByIdNew,
  putApiV1BridgeBehavior,
  putApiV1BridgePreset,
} from "../../lib/api/sdk.gen";
import { BridgeConfirmDialog } from "../components/bridge/confirm-dialog";
import {
  ModelAdvancedOptions,
  ModelDescription,
  type ModelOptions,
  defaultModelOptions,
} from "../components/bridge/model-options";
import { SavedModelConnection } from "../components/bridge/saved-model-connection";
import { WhaleCompanion } from "../components/bridge/whale-companion";
import { useModelDiscovery } from "../hooks/use-model-discovery";

type SettingsTab = "model" | "preset" | "sessions";
const PRESET_SUGGESTIONS = [
  { label: "简洁直接", text: "请用简洁的中文回答，先给结论，再补充必要说明。" },
  { label: "耐心解释", text: "请耐心解释，用容易理解的例子帮助我掌握新知识。" },
  {
    label: "轻松自然",
    text: "请像朋友一样自然地交流，语气轻松，少用生硬的术语。",
  },
];

export function BridgeSettingsPage({
  section: tab = "model",
}: { section?: SettingsTab }) {
  const cache = useQueryClient();
  const [page, setPage] = useState(0);
  const [provider, setProvider] = useState<"deepseek" | "custom-openai">(
    "deepseek",
  );
  const [apiKey, setApiKey] = useState("");
  const [providerPreset, setProviderPreset] = useState("deepseek");
  const [modelOptions, setModelOptions] = useState<ModelOptions>({
    ...defaultModelOptions,
  });
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("deepseek-chat");
  const [baseUrl, setBaseUrl] = useState("");
  const [manualModel, setManualModel] = useState(false);
  const [configureNewApi, setConfigureNewApi] = useState(false);
  const savedConnections = useQuery({
    queryKey: ["bridge-saved-models"],
    enabled: tab === "model",
    queryFn: async () =>
      (await getApiV1BridgeModelsSaved({ throwOnError: true })).data,
  });
  const discovery = useModelDiscovery();
  const discoveredModels = discovery.result?.models ?? [];
  const canDiscover =
    Boolean(apiKey.trim()) &&
    (provider === "deepseek" || Boolean(baseUrl.trim()));
  async function discoverModels(force = false) {
    if (
      !canDiscover ||
      discovery.loading ||
      (!force && (discovery.result || manualModel))
    )
      return;
    const result = await discovery.discover({
      provider,
      apiKey: apiKey.trim(),
      ...(provider === "custom-openai" ? { baseUrl: baseUrl.trim() } : {}),
    });
    if (result?.ok && !manualModel) {
      setModel(
        result.models.includes(model) ? model : (result.models[0] ?? ""),
      );
      test.reset();
    }
  }
  const [draft, setDraft] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const selected = useQuery({
    queryKey: ["desktop-default-model"],
    enabled: tab === "model" || tab === "preset",
    queryFn: async () =>
      (await getApiInternalDesktopDefaultModel({ throwOnError: true })).data,
  });
  const preset = useQuery({
    queryKey: ["bridge-preset"],
    enabled: tab === "preset",
    queryFn: async () =>
      (await getApiV1BridgePreset({ throwOnError: true })).data,
  });
  const behavior = useQuery({
    queryKey: ["bridge-behavior"],
    enabled: tab === "preset",
    queryFn: async () =>
      (await getApiV1BridgeBehavior({ throwOnError: true })).data,
  });
  const persona = useMutation({
    mutationFn: async (value: "auto" | "whale" | "none") =>
      (
        await putApiV1BridgeBehavior({
          body: { ...behavior.data, persona: value },
          throwOnError: true,
        })
      ).data,
    onSuccess: (data) => cache.setQueryData(["bridge-behavior"], data),
  });
  const test = useMutation({
    mutationFn: async () =>
      (
        await postApiV1BridgeModel({
          body: {
            provider,
            apiKey,
            model,
            options: {
              ...modelOptions,
              thinking:
                (provider === "deepseek" ||
                  /^https:\/\/api\.deepseek\.com(?:\/|$)/.test(baseUrl)) &&
                ["deepseek-flash", "deepseek-v4-pro"].includes(model)
                  ? modelOptions.thinking
                  : "auto",
            },
            ...(provider === "custom-openai" ? { baseUrl } : {}),
          },
          signal: AbortSignal.timeout(
            (modelOptions.timeoutSeconds + 60) * 1000,
          ),
          throwOnError: true,
        })
      ).data,
    onSuccess: (result) => {
      if (result?.saved) {
        discovery.reset();
        setApiKey("");
        setShowKey(false);
        setConfigureNewApi(false);
        void cache.invalidateQueries({ queryKey: ["bridge-saved-models"] });
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
    enabled: tab === "sessions",
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
      setResetId(null);
      void cache.invalidateQueries({ queryKey: ["bridge-sessions"] });
    },
  });
  const wechatSessions =
    sessions.data?.sessions.filter((item) =>
      ["wechat", "openclaw-weixin"].includes(item.channelType ?? ""),
    ) ?? [];
  const sessionPage = Math.min(
    page,
    Math.max(0, Math.ceil(wechatSessions.length / 4) - 1),
  );
  const presetValue = draft ?? preset.data?.preset ?? "";
  const personaMode = behavior.data?.persona ?? "whale";
  const whaleDefault =
    personaMode === "whale" ||
    (personaMode === "auto" && isDeepSeekModel(selected.data?.modelId));
  return (
    <div className={`bridge-page bridge-settings bridge-settings-${tab}`}>
      <div className="bridge-page-heading">
        <div>
          <span className="bridge-eyebrow">
            {tab === "model"
              ? "第 1 步 · 配置 API"
              : tab === "preset"
                ? "人设与预设"
                : "会话与上下文"}
          </span>
          <h1>
            {tab === "model"
              ? "模型连接"
              : tab === "preset"
                ? "回答风格"
                : "对话管理"}
          </h1>
          <p>
            {tab === "model"
              ? savedConnections.data?.connections?.length && !configureNewApi
                ? "使用已保存的 API 选择模型，无需重复填写密钥。"
                : "填写密钥，读取并选择模型。测试通过后，下一步连接微信。"
              : tab === "preset"
                ? "写下你的偏好，之后的回答会参考这份说明。"
                : "想换个话题时，新开一段对话，让 AI 从新的上下文开始。"}
          </p>
        </div>
        <Link className="bridge-back-link" to="/workspace">
          返回总览
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="bridge-settings-grid">
        <div className="bridge-settings-panel bridge-panel" key={tab}>
          {tab === "model" && (
            <>
              <div className="bridge-form-heading">
                <span className="bridge-icon-box">
                  <KeyRound size={22} strokeWidth={1.5} />
                </span>
                <div>
                  <h2>连接你的模型</h2>
                  <p>这里只需要服务商提供的 API Key，不需要微信密码。</p>
                </div>
              </div>
              {selected.isError && (
                <p role="alert" className="bridge-feedback is-error">
                  已保存模型读取失败，请检查本地服务。
                </p>
              )}
              {selected.data?.modelId && (
                <div className="bridge-saved-model">
                  <Check size={17} />
                  <span>
                    已保存模型<strong>{selected.data.modelId}</strong>
                  </span>
                  <Link to="/workspace/wechat" className="bridge-saved-next">
                    下一步：连接微信
                    <ArrowRight size={16} />
                  </Link>
                </div>
              )}
              {savedConnections.isError && (
                <p role="alert" className="bridge-feedback is-error">
                  暂时无法读取已保存 API。
                  <button
                    type="button"
                    className="bridge-text-button"
                    onClick={() => void savedConnections.refetch()}
                  >
                    重新读取
                  </button>
                </p>
              )}
              {configureNewApi &&
                Boolean(savedConnections.data?.connections?.length) && (
                  <button
                    type="button"
                    className="bridge-text-button"
                    onClick={() => {
                      discovery.reset();
                      test.reset();
                      setConfigureNewApi(false);
                    }}
                  >
                    返回已保存 API
                  </button>
                )}
              {savedConnections.isPending ? (
                <output>正在读取已保存 API…</output>
              ) : !configureNewApi &&
                savedConnections.data?.connections?.length ? (
                <SavedModelConnection
                  data={savedConnections.data}
                  onConfigure={() => {
                    test.reset();
                    setConfigureNewApi(true);
                  }}
                />
              ) : test.data?.saved && test.data.ok ? (
                <div className="bridge-model-success">
                  <span className="bridge-icon-box">
                    <Check size={25} />
                  </span>
                  <h3>模型准备好了。</h3>
                  <output aria-live="polite">{test.data.message}</output>
                  <Link className="bridge-button" to="/workspace/wechat">
                    下一步：连接微信 <ArrowRight size={16} />
                  </Link>
                  <button
                    type="button"
                    className="bridge-text-button"
                    onClick={() => test.reset()}
                  >
                    继续修改模型
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (
                      discovery.loading ||
                      (!manualModel && !discoveredModels.includes(model))
                    )
                      return;
                    test.mutate();
                  }}
                >
                  <fieldset
                    disabled={test.isPending || selected.isError}
                    className="bridge-form-fields"
                  >
                    <div className="bridge-field">
                      <label htmlFor="bridge-provider">模型服务商</label>
                      <select
                        id="bridge-provider"
                        value={providerPreset}
                        onChange={(event) => {
                          const preset = event.target.value;
                          setProviderPreset(preset);
                          setProvider(
                            preset === "deepseek"
                              ? "deepseek"
                              : "custom-openai",
                          );
                          setBaseUrl(
                            preset === "bailian"
                              ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
                              : preset === "siliconflow"
                                ? "https://api.siliconflow.cn/v1"
                                : "",
                          );
                          setModelOptions({ ...defaultModelOptions });
                          setApiKey("");
                          setShowKey(false);
                          setModel(
                            event.target.value === "deepseek"
                              ? "deepseek-chat"
                              : "",
                          );
                          discovery.reset();
                          test.reset();
                        }}
                      >
                        <option value="deepseek">DeepSeek 官方 API</option>
                        <option value="bailian">阿里云百炼（北京）</option>
                        <option value="siliconflow">
                          硅基流动（中国大陆）
                        </option>
                        <option value="custom-openai">
                          其他 OpenAI 兼容服务
                        </option>
                      </select>
                    </div>
                    <div className="bridge-field">
                      <label htmlFor="bridge-model-name">
                        模型
                        <button
                          type="button"
                          className="bridge-text-button"
                          onClick={() => {
                            if (discovery.loading) discovery.reset();
                            setManualModel(!manualModel);
                            test.reset();
                          }}
                        >
                          {manualModel ? "从列表选择" : "手动填写"}
                        </button>
                      </label>
                      {manualModel ? (
                        <input
                          id="bridge-model-name"
                          required
                          maxLength={200}
                          value={model}
                          onChange={(event) => {
                            setModel(event.target.value);
                            test.reset();
                          }}
                          placeholder="服务商提供的模型 ID"
                        />
                      ) : (
                        <select
                          id="bridge-model-name"
                          required
                          value={discoveredModels.includes(model) ? model : ""}
                          disabled={
                            discovery.loading || !discoveredModels.length
                          }
                          onChange={(event) => {
                            setModel(event.target.value);
                            test.reset();
                          }}
                        >
                          <option value="" disabled>
                            {discovery.loading
                              ? "正在读取…"
                              : "填写密钥后自动读取"}
                          </option>
                          {discoveredModels.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="bridge-field bridge-field-full">
                      <label htmlFor="bridge-api-key">
                        API Key<span>模型服务商提供的密钥</span>
                      </label>
                      <div className="bridge-password-field">
                        <input
                          id="bridge-api-key"
                          type={showKey ? "text" : "password"}
                          autoComplete="off"
                          spellCheck={false}
                          required
                          maxLength={4096}
                          value={apiKey}
                          onChange={(event) => {
                            setApiKey(event.target.value);
                            discovery.reset();
                            test.reset();
                          }}
                          onBlur={() => void discoverModels()}
                          placeholder="粘贴你的 API Key"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey(!showKey)}
                          aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                        >
                          {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                    {provider === "custom-openai" && (
                      <div className="bridge-field bridge-field-full">
                        <label htmlFor="bridge-base-url">接口基础地址</label>
                        <input
                          id="bridge-base-url"
                          type="url"
                          required
                          value={baseUrl}
                          onChange={(event) => {
                            setBaseUrl(event.target.value);
                            discovery.reset();
                            test.reset();
                          }}
                          onBlur={() => void discoverModels()}
                          placeholder="https://example.com/v1"
                        />
                        <p className="bridge-field-hint">
                          填写服务商的基础地址，不包含
                          /chat/completions。密钥将发送至此地址。
                          {providerPreset === "bailian" &&
                            " 百炼密钥需匹配北京地域；工作空间专属地址可在此替换。"}
                        </p>
                      </div>
                    )}
                    <div className="bridge-model-discovery bridge-field-full">
                      <button
                        type="button"
                        className="bridge-text-button"
                        disabled={!canDiscover || discovery.loading}
                        onClick={() => void discoverModels(true)}
                      >
                        {discovery.loading ? (
                          <Loader2 size={15} className="bridge-spin" />
                        ) : (
                          <RefreshCw size={15} />
                        )}
                        {discovery.loading
                          ? "正在读取模型…"
                          : discoveredModels.length
                            ? "刷新模型列表"
                            : "读取模型列表"}
                      </button>
                      <output aria-live="polite">
                        {discovery.result?.message ??
                          "填完密钥后自动读取；不支持列表的接口可手动填写。"}
                      </output>
                    </div>
                    <ModelDescription model={model} result={discovery.result} />
                    <ModelAdvancedOptions
                      model={model}
                      deepseekOfficial={
                        provider === "deepseek" ||
                        /^https:\/\/api\.deepseek\.com(?:\/|$)/.test(baseUrl)
                      }
                      value={modelOptions}
                      onChange={(value) => {
                        setModelOptions(value);
                        test.reset();
                      }}
                    />
                    <p className="bridge-form-disclosure">
                      测试会生成一条简短回答，产生少量 API
                      用量。测试失败不会替换已保存的模型。
                    </p>
                    <button
                      type="submit"
                      className="bridge-button bridge-button-wide"
                      disabled={
                        discovery.loading ||
                        (!manualModel && !discoveredModels.includes(model))
                      }
                    >
                      {test.isPending ? (
                        <>
                          <Loader2 size={17} className="bridge-spin" />
                          正在测试并保存…
                        </>
                      ) : (
                        <>
                          测试并保存模型
                          <ArrowRight size={17} />
                        </>
                      )}
                    </button>
                  </fieldset>
                </form>
              )}
              {test.data && !test.data.ok && (
                <output aria-live="polite" className="bridge-feedback is-error">
                  {test.data.message}
                </output>
              )}
              {test.isError && (
                <p role="alert" className="bridge-feedback is-error">
                  本地服务没有及时完成请求。请刷新检查已保存模型，再决定是否重试。
                </p>
              )}
            </>
          )}
          {tab === "preset" && (
            <>
              <div className="bridge-form-heading">
                <span className="bridge-icon-box">
                  <Sparkles size={22} strokeWidth={1.5} />
                </span>
                <div>
                  <h2>编辑回答预设</h2>
                  <p>你的表达习惯，也可以成为 AI 的习惯。</p>
                </div>
              </div>
              {preset.isError ? (
                <div className="bridge-feedback is-error">
                  预设读取失败。
                  <button
                    type="button"
                    className="bridge-text-button"
                    onClick={() => void preset.refetch()}
                  >
                    重新读取
                    <RefreshCw size={15} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="bridge-field">
                    <div className="bridge-persona-setting">
                      <label htmlFor="bridge-persona">默认人设</label>
                      <select
                        id="bridge-persona"
                        value={personaMode}
                        disabled={
                          !behavior.data ||
                          behavior.isError ||
                          persona.isPending
                        }
                        onChange={(event) =>
                          persona.mutate(
                            event.target.value as "auto" | "whale" | "none",
                          )
                        }
                      >
                        <option value="auto">跟随模型 · DeepSeek 大肥鱼</option>
                        <option value="whale">始终使用 · 大肥鱼</option>
                        <option value="none">关闭默认人设</option>
                      </select>
                    </div>
                    <p
                      className="bridge-persona-note"
                      role={
                        behavior.isError || persona.isError
                          ? "alert"
                          : undefined
                      }
                    >
                      {behavior.isError || persona.isError
                        ? "人设设置未能读取或保存，请重试。"
                        : presetValue.trim()
                          ? "下方自定义内容保存后优先使用；留空恢复所选默认人设。"
                          : whaleDefault
                            ? "大肥鱼已就位：爱米饭、爱摸鱼，认真时很靠谱。"
                            : personaMode === "auto"
                              ? "连接 DeepSeek 后自动使用大肥鱼，其他模型保持普通助手。"
                              : "当前使用普通助手风格。"}
                      {!presetValue.trim() && personaMode !== "none" && (
                        <button
                          type="button"
                          className="bridge-text-button"
                          disabled={preset.isPending || savePreset.isPending}
                          onClick={() => {
                            setDraft(WHALE_PERSONA);
                            savePreset.reset();
                          }}
                        >
                          编辑大肥鱼预设
                        </button>
                      )}
                    </p>
                    <label htmlFor="bridge-preset">
                      你的 AI 预设<span>可选</span>
                    </label>
                    <textarea
                      id="bridge-preset"
                      aria-label="AI 预设"
                      rows={6}
                      maxLength={16000}
                      disabled={preset.isPending || savePreset.isPending}
                      value={presetValue}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        savePreset.reset();
                      }}
                      placeholder="例如：用简洁的中文回答，先给结论，再解释。称呼我为小林。"
                    />
                    <span className="bridge-character-count">
                      {presetValue.length.toLocaleString()} / 16,000
                    </span>
                  </div>
                  <div className="bridge-preset-suggestions">
                    <span>预设示例</span>
                    {PRESET_SUGGESTIONS.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        disabled={preset.isPending || savePreset.isPending}
                        onClick={() => {
                          setDraft(
                            [presetValue, item.text]
                              .filter(Boolean)
                              .join("\n")
                              .slice(0, 16000),
                          );
                          savePreset.reset();
                        }}
                      >
                        <PlusIcon />
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="bridge-form-bottom">
                    <p className="bridge-field-hint">
                      下一次回复开始生效。
                      <br />
                      留空保存恢复所选默认人设。
                    </p>
                    <button
                      type="button"
                      className="bridge-button"
                      disabled={preset.isPending || savePreset.isPending}
                      onClick={() => savePreset.mutate()}
                    >
                      {savePreset.isPending ? (
                        <Loader2 size={16} className="bridge-spin" />
                      ) : (
                        <Save size={16} />
                      )}
                      保存预设
                    </button>
                  </div>
                </>
              )}
              {savePreset.isSuccess && (
                <output
                  aria-live="polite"
                  className="bridge-feedback is-success"
                >
                  <Check size={16} />
                  预设已保存。
                </output>
              )}
              {savePreset.isError && (
                <p role="alert" className="bridge-feedback is-error">
                  保存或同步失败，请检查本地服务后重试。
                </p>
              )}
            </>
          )}
          {tab === "sessions" && (
            <>
              <div className="bridge-form-heading">
                <span className="bridge-icon-box">
                  <MessageCircle size={22} strokeWidth={1.5} />
                </span>
                <div>
                  <h2>微信会话</h2>
                  <p>为微信会话重新开始上下文，保留你的预设。</p>
                </div>
              </div>
              <div className="bridge-session-toolbar">
                <span>最近的微信对话</span>
                <button
                  type="button"
                  className="bridge-text-button"
                  onClick={() => void sessions.refetch()}
                >
                  <RefreshCw
                    size={15}
                    className={sessions.isFetching ? "bridge-spin" : ""}
                  />
                  刷新
                </button>
              </div>
              {sessions.isPending && (
                <div className="bridge-settings-empty">
                  <Loader2 size={26} className="bridge-spin" />
                  <p>正在读取对话…</p>
                </div>
              )}
              {sessions.isError && (
                <p role="alert" className="bridge-feedback is-error">
                  读取失败，请检查本地服务。
                </p>
              )}
              {!sessions.isPending &&
                !sessions.isError &&
                wechatSessions.length === 0 && (
                  <div className="bridge-settings-empty">
                    <span>
                      <MessageCircle size={30} strokeWidth={1.3} />
                    </span>
                    <h3>暂无微信会话</h3>
                    <p>
                      在微信聊过之后，
                      <br />
                      你的对话就会出现在这里。
                    </p>
                    <Link className="bridge-text-button" to="/workspace/wechat">
                      前往微信连接
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                )}
              {wechatSessions
                .slice(sessionPage * 4, sessionPage * 4 + 4)
                .map((session) => (
                  <div className="bridge-session-row" key={session.id}>
                    <span className="bridge-session-icon">
                      <MessageCircle size={18} />
                    </span>
                    <span className="bridge-session-title">
                      {session.title || "微信对话"}
                    </span>
                    <button
                      type="button"
                      className="bridge-text-button"
                      disabled={resetSession.isPending}
                      onClick={() => setResetId(session.id)}
                    >
                      <RotateCcw size={15} />
                      新开对话
                    </button>
                  </div>
                ))}
              {wechatSessions.length > 4 && (
                <div className="bridge-pagination">
                  <button
                    type="button"
                    disabled={sessionPage === 0}
                    onClick={() => setPage(sessionPage - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {sessionPage + 1} / {Math.ceil(wechatSessions.length / 4)}
                  </span>
                  <button
                    type="button"
                    disabled={(sessionPage + 1) * 4 >= wechatSessions.length}
                    onClick={() => setPage(sessionPage + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
              {resetSession.data && (
                <output
                  aria-live="polite"
                  className={`bridge-feedback ${resetSession.data.ok ? "is-success" : "is-error"}`}
                >
                  {resetSession.data.message}
                </output>
              )}
              {resetSession.isError && (
                <p role="alert" className="bridge-feedback is-error">
                  操作未能完成，请检查本地服务后重试。
                </p>
              )}
            </>
          )}
        </div>
        <aside className="bridge-settings-aside">
          <div className="bridge-editorial-card">
            <span className="bridge-eyebrow">使用说明</span>
            <div className="bridge-editorial-art">
              <span />
              <span />
              <Sparkles size={32} strokeWidth={1.25} />
            </div>
            <div className="bridge-whale-editorial">
              <WhaleCompanion />
              <span>大肥鱼：有事直接说。</span>
            </div>
            <h2>
              {tab === "model" ? (
                <>
                  使用自己的 API，
                  <br />
                  费用由服务商收取。
                </>
              ) : tab === "preset" ? (
                <>
                  默认大肥鱼，
                  <br />
                  预设可以修改。
                </>
              ) : (
                <>
                  新开对话，
                  <br />
                  重置当前上下文。
                </>
              )}
            </h2>
            <p>
              {tab === "model"
                ? "只需准备服务商的 API Key，无需服务器，也不需要微信密码。"
                : tab === "preset"
                  ? "简洁一点，耐心一点，或多一点幽默。告诉 AI，你喜欢的方式。"
                  : "新开对话保留预设和联系人记忆，不删除本机历史记录。"}
            </p>
          </div>
          {tab === "model" ? (
            <div className="bridge-settings-tip">
              <h3>连接只需三小步</h3>
              <ol className="bridge-model-instructions">
                <li>
                  <span>1</span>选择服务商，填写 API Key。
                </li>
                <li>
                  <span>2</span>选择模型，测试并保存。
                </li>
                <li>
                  <span>3</span>前往微信连接，用手机扫码。
                </li>
              </ol>
              <Link
                to="/workspace/models/advanced?tab=providers"
                className="bridge-text-button"
              >
                其他协议与供应商管理 <ArrowUpRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="bridge-settings-tip">
              <h3>
                {tab === "preset"
                  ? "保存后，什么时候生效？"
                  : "历史记录会被删除吗？"}
              </h3>
              <p>
                {tab === "preset"
                  ? "下一次回复生效，自定义内容优先。留空恢复默认人设；想完全取消角色，请关闭默认人设。已有对话上下文保留。"
                  : "新开对话只重置上下文，不会删除本机历史记录或手机上的微信聊天。"}
              </p>
            </div>
          )}
        </aside>
      </div>
      <BridgeConfirmDialog
        open={resetId !== null}
        onOpenChange={(open) => {
          if (!open) setResetId(null);
        }}
        title="新开对话并重置上下文？"
        description="下次回复将不再携带旧上下文，你的预设会保留。本机和手机上的历史记录不会删除。"
        confirmLabel="新开对话"
        pending={resetSession.isPending}
        onConfirm={() => {
          if (resetId) resetSession.mutate(resetId);
        }}
      />
    </div>
  );
}

function PlusIcon() {
  return <span aria-hidden="true">+</span>;
}
