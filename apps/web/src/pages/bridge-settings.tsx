import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
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
import { BridgeConfirmDialog } from "../components/bridge/confirm-dialog";

const SETTINGS_TABS = [
  { id: "model", label: "模型连接", icon: KeyRound },
  { id: "preset", label: "回答风格", icon: Sparkles },
  { id: "sessions", label: "对话管理", icon: MessageCircle },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];
const PRESET_SUGGESTIONS = [
  { label: "简洁直接", text: "请用简洁的中文回答，先给结论，再补充必要说明。" },
  { label: "耐心解释", text: "请耐心解释，用容易理解的例子帮助我掌握新知识。" },
  {
    label: "轻松自然",
    text: "请像朋友一样自然地交流，语气轻松，少用生硬的术语。",
  },
];

export function BridgeSettingsPage() {
  const cache = useQueryClient();
  const [tab, setTab] = useState<SettingsTab>("model");
  const [provider, setProvider] = useState<"deepseek" | "custom-openai">(
    "deepseek",
  );
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("deepseek-chat");
  const [baseUrl, setBaseUrl] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
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
        setShowKey(false);
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
      setResetId(null);
      void cache.invalidateQueries({ queryKey: ["bridge-sessions"] });
    },
  });
  const wechatSessions =
    sessions.data?.sessions.filter((item) =>
      ["wechat", "openclaw-weixin"].includes(item.channelType ?? ""),
    ) ?? [];
  const presetValue = draft ?? preset.data?.preset ?? "";
  return (
    <div className="bridge-page bridge-settings">
      <div className="bridge-page-heading">
        <div>
          <span className="bridge-eyebrow">MAKE IT YOURS</span>
          <h1>
            {tab === "model"
              ? "第 1 步：配置模型 API"
              : tab === "preset"
                ? "让回答更合你的心意。"
                : "管理你的微信对话。"}
          </h1>
          <p>
            {tab === "model"
              ? "选择接口类型，填写密钥。测试通过后，下一步连接微信。"
              : tab === "preset"
                ? "写下你的偏好，之后的回答会参考这份说明。"
                : "想换个话题时，新开一段对话，让 AI 从新的上下文开始。"}
          </p>
        </div>
        <Link className="bridge-back-link" to="/workspace">
          返回微信连接
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <div
        className="bridge-settings-tabs"
        role="tablist"
        aria-label="AI 设置分类"
      >
        {SETTINGS_TABS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={tab === item.id ? `panel-${item.id}` : undefined}
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? "is-active" : ""}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % SETTINGS_TABS.length
                  : event.key === "ArrowLeft"
                    ? (index + SETTINGS_TABS.length - 1) % SETTINGS_TABS.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? SETTINGS_TABS.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                const target = SETTINGS_TABS[next]?.id;
                if (target) {
                  setTab(target);
                  document.getElementById(`tab-${target}`)?.focus();
                }
              }
            }}
          >
            <item.icon size={17} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="bridge-settings-grid">
        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="bridge-settings-panel bridge-panel"
          key={tab}
        >
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
              <ol className="bridge-form-guide">
                <li>
                  <span>1</span>选择你购买 API 的服务商类型。
                </li>
                <li>
                  <span>2</span>粘贴 API Key，点击「测试并保存模型」。
                </li>
                <li>
                  <span>3</span>看到测试成功后，点击「下一步：连接微信」。
                </li>
              </ol>
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
                  <Link to="/workspace?connect=1" className="bridge-saved-next">
                    下一步：连接微信
                    <ArrowRight size={16} />
                  </Link>
                </div>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  test.mutate();
                }}
              >
                <fieldset
                  disabled={test.isPending || selected.isError}
                  className="bridge-form-fields"
                >
                  <div className="bridge-field">
                    <label htmlFor="bridge-provider">
                      你使用哪种模型服务？
                    </label>
                    <select
                      id="bridge-provider"
                      value={provider}
                      onChange={(event) => {
                        setProvider(event.target.value as typeof provider);
                        test.reset();
                      }}
                    >
                      <option value="deepseek">DeepSeek 官方 API</option>
                      <option value="custom-openai">
                        其他 OpenAI 兼容服务
                      </option>
                    </select>
                    <p className="bridge-field-hint">
                      其他服务商的密钥请选择「其他 OpenAI
                      兼容服务」，并填写其接口地址和模型名称。
                    </p>
                  </div>
                  <div className="bridge-provider">
                    <span className="bridge-provider-logo">
                      {provider === "deepseek" ? (
                        <img src="/model-provider-icons/deepseek.svg" alt="" />
                      ) : (
                        <SlidersHorizontal size={25} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {provider === "deepseek"
                          ? "DeepSeek"
                          : "自定义兼容接口"}
                      </strong>
                      <span>
                        {provider === "deepseek"
                          ? "简单开始，随时切换"
                          : "使用你熟悉的模型服务"}
                      </span>
                    </div>
                    <span className="bridge-badge">
                      {provider === "deepseek" ? "默认推荐" : "自定义"}
                    </span>
                  </div>
                  <div className="bridge-field">
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
                          test.reset();
                        }}
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
                  <details
                    className="bridge-advanced"
                    open={provider === "custom-openai" ? true : undefined}
                  >
                    <summary>
                      <span>
                        <SlidersHorizontal size={15} />
                        {provider === "custom-openai"
                          ? "填写接口地址与模型"
                          : "高级设置"}
                      </span>
                      <span>
                        接口与模型
                        <ChevronDown size={15} />
                      </span>
                    </summary>
                    <div className="bridge-advanced-fields">
                      {provider === "custom-openai" && (
                        <div className="bridge-field">
                          <label htmlFor="bridge-base-url">接口基础地址</label>
                          <input
                            id="bridge-base-url"
                            type="url"
                            required
                            value={baseUrl}
                            onChange={(event) => {
                              setBaseUrl(event.target.value);
                              test.reset();
                            }}
                            placeholder="https://example.com/v1"
                          />
                          <p className="bridge-field-hint">
                            不要填写
                            /chat/completions；密钥将发送到你填写的地址。
                          </p>
                        </div>
                      )}
                      <div className="bridge-field">
                        <label htmlFor="bridge-model-name">模型名称</label>
                        <input
                          id="bridge-model-name"
                          required
                          maxLength={200}
                          value={model}
                          onChange={(event) => {
                            setModel(event.target.value);
                            test.reset();
                          }}
                        />
                      </div>
                      <Link
                        className="bridge-text-button"
                        to="/workspace/models/advanced?tab=providers"
                      >
                        其他协议及已有供应商管理
                        <ArrowUpRight size={15} />
                      </Link>
                    </div>
                  </details>
                  <p className="bridge-form-disclosure">
                    测试会生成一条简短回答，产生少量 API
                    用量。测试失败不会替换已保存的模型。
                  </p>
                  <button
                    type="submit"
                    className="bridge-button bridge-button-wide"
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
                {test.data && (
                  <output
                    aria-live="polite"
                    className={`bridge-feedback ${test.data.ok ? "is-success" : "is-error"}`}
                  >
                    {test.data.message}
                  </output>
                )}
                {test.isError && (
                  <p role="alert" className="bridge-feedback is-error">
                    本地服务没有及时完成请求。请刷新检查已保存模型，再决定是否重试。
                  </p>
                )}
                {test.data?.saved && (
                  <Link
                    className="bridge-button bridge-button-wide bridge-next-step"
                    to="/workspace?connect=1"
                  >
                    下一步：连接微信
                    <ArrowRight size={16} />
                  </Link>
                )}
              </form>
            </>
          )}
          {tab === "preset" && (
            <>
              <div className="bridge-form-heading">
                <span className="bridge-icon-box">
                  <Sparkles size={22} strokeWidth={1.5} />
                </span>
                <div>
                  <h2>让回答，更合你意。</h2>
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
                    <label htmlFor="bridge-preset">
                      你的 AI 预设<span>可选</span>
                    </label>
                    <textarea
                      id="bridge-preset"
                      aria-label="AI 预设"
                      rows={8}
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
                    <span>找一点灵感</span>
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
                      留空保存可取消预设。
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
                  <h2>随时，开启新一页。</h2>
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
                    <h3>新的故事，还没开始。</h3>
                    <p>
                      在微信聊过之后，
                      <br />
                      你的对话就会出现在这里。
                    </p>
                    <Link className="bridge-text-button" to="/workspace">
                      回到微信连接
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                )}
              {wechatSessions.map((session) => (
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
            <span className="bridge-eyebrow">A BRIDGE, NOT A BOUNDARY</span>
            <div className="bridge-editorial-art">
              <span />
              <span />
              <Sparkles size={32} strokeWidth={1.25} />
            </div>
            <h2>
              {tab === "model" ? (
                <>
                  模型你来选。
                  <br />
                  连接交给我们。
                </>
              ) : tab === "preset" ? (
                <>
                  同一个 AI，
                  <br />
                  更多你的风格。
                </>
              ) : (
                <>
                  好的对话，
                  <br />
                  也值得重新开始。
                </>
              )}
            </h2>
            <p>
              {tab === "model"
                ? "从一个 API Key 开始，把喜欢的 AI 带进每天都在用的微信。"
                : tab === "preset"
                  ? "简洁一点，耐心一点，或是多一点幽默。用你自己的话，告诉 AI 你喜欢的方式。"
                  : "需要切换话题时，新开对话让 AI 放下旧的上下文，带着你的预设重新出发。"}
            </p>
            <span className="bridge-editorial-signature">
              Yours, by design.
            </span>
          </div>
          <div className="bridge-settings-tip">
            <span className="bridge-tip-number">GOOD TO KNOW</span>
            <h3>
              {tab === "model"
                ? "API Key 从哪里来？"
                : tab === "preset"
                  ? "预设会怎样生效？"
                  : "历史记录会被删除吗？"}
            </h3>
            <p>
              {tab === "model"
                ? "在你选择的模型服务商处创建密钥。模型用量由服务商计费，Bridge 帮你完成本机连接。"
                : tab === "preset"
                  ? "保存后从下一次回复开始加载，已有对话的上下文仍会保留。想从头聊，可以去「对话管理」。"
                  : "新开对话会重置上下文，不会删除本机历史记录，也不会删除手机上的微信聊天记录。"}
            </p>
          </div>
        </aside>
      </div>
      <BridgeConfirmDialog
        open={resetId !== null}
        onOpenChange={(open) => {
          if (!open) setResetId(null);
        }}
        title="为这段对话翻开新一页？"
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
