import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  Clock3,
  ImagePlus,
  Loader2,
  MessagesSquare,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  deleteApiV1BridgeStickersById,
  getApiV1BridgeBehavior,
  getApiV1BridgeBehaviorStatus,
  getApiV1BridgeStickers,
  getApiV1Channels,
  postApiV1BridgeStickers,
  putApiV1BridgeBehavior,
} from "../../lib/api/sdk.gen";
import type { GetApiV1BridgeBehaviorResponse } from "../../lib/api/types.gen";
import { client } from "../lib/api";
import { chatRecipes } from "../lib/bridge-chat-recipes";

type Config = Required<
  Omit<GetApiV1BridgeBehaviorResponse, "stickers" | "proactive" | "delivery">
> & {
  delivery: Required<NonNullable<GetApiV1BridgeBehaviorResponse["delivery"]>>;
  stickers: Required<NonNullable<GetApiV1BridgeBehaviorResponse["stickers"]>>;
  proactive: Required<NonNullable<GetApiV1BridgeBehaviorResponse["proactive"]>>;
};
const defaults: Config = {
  persona: "auto",
  tone: "natural",
  length: "balanced",
  emoji: "occasional",
  followUp: "natural",
  actions: "off",
  examples: "",
  delivery: { mode: "single", maxBubbles: 2, pauseMs: 1200 },
  stickers: { enabled: false, probability: 25, cooldownMinutes: 10 },
  proactive: {
    enabled: false,
    channelIds: [],
    intervalMinutes: 120,
    quietStart: "22:00",
    quietEnd: "08:00",
    dailyLimit: 3,
    unansweredLimit: 1,
    prompt:
      "自然地问候，或接着之前的话题轻轻聊一句。不要催促回复，不要虚构实时消息。",
  },
};
const tabs = [
  { id: "chat", label: "聊天方式", icon: Sparkles },
  { id: "rhythm", label: "接话与节奏", icon: MessagesSquare },
  { id: "stickers", label: "表情图库", icon: ImagePlus },
  { id: "proactive", label: "主动聊天", icon: Clock3 },
] as const;
const statusLabels: Record<string, string> = {
  waiting: "等待本次启动后的微信消息",
  disabled: "主动聊天未开启",
  paused: "已随自动回复暂停",
  quiet: "免打扰时段",
  cooldown: "等待下次聊天时机",
  limit: "已达上限，等待你回复或次日额度",
  expired: "会话凭据过旧，请在微信发一条消息",
  generating: "正在准备主动消息",
  sent: "微信已接受发送",
  error: "本次未发出，收到新消息后再尝试",
};
function errorMessage(error: unknown, fallback: string) {
  return error &&
    typeof error === "object" &&
    "error" in error &&
    typeof error.error === "string"
    ? error.error
    : fallback;
}

export function BehaviorPage() {
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((t) => t.id === params.get("tab"))?.id ?? "chat";
  const [draft, setDraft] = useState<Config | null>(null);
  const query = useQuery({
    queryKey: ["bridge-behavior"],
    queryFn: async () =>
      (await getApiV1BridgeBehavior({ throwOnError: true })).data,
  });
  const stickers = useQuery({
    queryKey: ["bridge-stickers"],
    queryFn: async () =>
      (await getApiV1BridgeStickers({ throwOnError: true })).data,
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await getApiV1Channels({ throwOnError: true })).data,
  });
  const status = useQuery({
    queryKey: ["bridge-behavior-status"],
    enabled: tab === "proactive",
    queryFn: async () =>
      (await getApiV1BridgeBehaviorStatus({ throwOnError: true })).data,
    refetchInterval: 5000,
  });
  const config = draft ?? {
    ...defaults,
    ...query.data,
    stickers: { ...defaults.stickers, ...query.data?.stickers },
    proactive: { ...defaults.proactive, ...query.data?.proactive },
    delivery: { ...defaults.delivery, ...query.data?.delivery },
  };
  const save = useMutation({
    mutationFn: async () =>
      (await putApiV1BridgeBehavior({ body: config, throwOnError: true })).data,
    onSuccess: (data) => {
      cache.setQueryData(["bridge-behavior"], data);
      setDraft(null);
      void cache.invalidateQueries({ queryKey: ["bridge-behavior-status"] });
    },
  });
  const update = (patch: Partial<Config>) => {
    setDraft({ ...config, ...patch });
    save.reset();
  };
  const patchProactive = (patch: Partial<Config["proactive"]>) =>
    update({ proactive: { ...config.proactive, ...patch } });
  const patchStickers = (patch: Partial<Config["stickers"]>) =>
    update({ stickers: { ...config.stickers, ...patch } });
  const patchDelivery = (patch: Partial<Config["delivery"]>) =>
    update({ delivery: { ...config.delivery, ...patch } });
  const wechat =
    channels.data?.channels.filter((c) => c.channelType === "wechat") ?? [];
  const validationMessage =
    !Number.isInteger(config.proactive.intervalMinutes) ||
    config.proactive.intervalMinutes < 5 ||
    config.proactive.intervalMinutes > 1440
      ? "主动聊天间隔需要是 5–1440 分钟的整数。"
      : !Number.isInteger(config.stickers.cooldownMinutes) ||
          config.stickers.cooldownMinutes < 1 ||
          config.stickers.cooldownMinutes > 1440
        ? "表情间隔需要是 1–1440 分钟的整数。"
        : !config.proactive.prompt.trim()
          ? "请填写希望 AI 主动聊什么。"
          : !config.proactive.quietStart || !config.proactive.quietEnd
            ? "请填写完整的免打扰起止时间。"
            : config.proactive.enabled &&
                config.proactive.channelIds.length === 0
              ? "开启主动聊天前，请先选择一个微信连接。"
              : "";
  return (
    <div className="bridge-page bridge-behavior-page">
      <header className="bridge-page-heading">
        <div>
          <span className="bridge-eyebrow">A LITTLE MORE PERSONAL</span>
          <h1>聊天，可以更有温度。</h1>
          <p>说话的方式、一个表情、偶尔的问候，都由你决定。</p>
        </div>
        <Link to="/workspace/preset" className="bridge-back-link">
          编写完整预设 <ArrowUpRight size={16} />
        </Link>
      </header>
      <nav className="bridge-behavior-tabs" aria-label="聊天行为分类">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setParams(t.id === "chat" ? {} : { tab: t.id })}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </nav>
      {query.isError ? (
        <div className="bridge-feedback is-error" role="alert">
          无法读取行为配置。
          <button type="button" onClick={() => void query.refetch()}>
            重新读取
          </button>
        </div>
      ) : query.isPending ? (
        <output>正在读取设置…</output>
      ) : (
        <>
          {tab === "stickers" ? (
            <div className="bridge-behavior-columns">
              <section className="bridge-panel bridge-behavior-panel">
                <StickerLibrary
                  items={stickers.data ?? []}
                  loading={stickers.isPending}
                  error={stickers.isError}
                />
              </section>
              <section className="bridge-panel bridge-behavior-panel bridge-behavior-options">
                <h2>什么时候发一个表情？</h2>
                <fieldset disabled={save.isPending}>
                  <label className="bridge-behavior-toggle">
                    <span>
                      <strong>允许 AI 选择表情</strong>
                      <small>根据你填写的标签判断是否合适</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.stickers.enabled}
                      onChange={(e) =>
                        patchStickers({ enabled: e.target.checked })
                      }
                    />
                  </label>
                  <label className="bridge-field">
                    使用概率 <strong>{config.stickers.probability}%</strong>
                    <input
                      aria-label="表情使用概率"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={config.stickers.probability}
                      onChange={(e) =>
                        patchStickers({ probability: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="bridge-field">
                    同一会话至少间隔（分钟）
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={config.stickers.cooldownMinutes}
                      onChange={(e) =>
                        patchStickers({
                          cooldownMinutes: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </fieldset>
                <p className="bridge-behavior-hint">
                  一次最多一张。AI
                  先判断语境，再按概率与间隔决定是否发送；图片不足或不合适时只发文字。
                </p>
                <p className="bridge-behavior-hint">
                  通过微信图片消息发送。GIF
                  是否动起来取决于客户端，不等同于微信原生收藏表情。
                </p>
              </section>
            </div>
          ) : (
            <div className="bridge-behavior-columns">
              <section className="bridge-panel bridge-behavior-panel">
                <fieldset disabled={save.isPending}>
                  {tab === "chat" ? (
                    <>
                      <h2>让它用你喜欢的方式说话。</h2>
                      <p className="bridge-behavior-hint">
                        与「回答风格」里的完整预设一起生效，下次回答开始使用。
                      </p>
                      <Choice
                        label="语气"
                        value={config.tone}
                        onChange={(tone) => update({ tone })}
                        options={[
                          {
                            value: "natural",
                            title: "自然随和",
                            detail: "少一点客服感",
                          },
                          {
                            value: "warm",
                            title: "温和耐心",
                            detail: "多一点理解",
                          },
                          {
                            value: "concise",
                            title: "直接利落",
                            detail: "先说重点",
                          },
                        ]}
                      />
                      <Choice
                        label="回答长短"
                        value={config.length}
                        onChange={(length) => update({ length })}
                        options={[
                          {
                            value: "short",
                            title: "简短",
                            detail: "日常一到三句",
                          },
                          {
                            value: "balanced",
                            title: "适中",
                            detail: "按问题展开",
                          },
                          {
                            value: "detailed",
                            title: "详细",
                            detail: "解释和例子",
                          },
                        ]}
                      />
                      <label className="bridge-field bridge-emoji-field">
                        文字 Emoji
                        <select
                          value={config.emoji}
                          onChange={(e) =>
                            update({ emoji: e.target.value as Config["emoji"] })
                          }
                        >
                          <option value="off">不使用</option>
                          <option value="occasional">偶尔点缀</option>
                          <option value="expressive">更有表情</option>
                        </select>
                      </label>
                    </>
                  ) : tab === "rhythm" ? (
                    <>
                      <h2>像聊天一样，一句接一句。</h2>
                      <p className="bridge-behavior-hint">
                        只拆分简短闲聊；长回答、代码和链接保持完整。
                      </p>
                      <div className="bridge-proactive-fields bridge-rhythm-fields">
                        <label className="bridge-field">
                          发送方式
                          <select
                            value={config.delivery.mode}
                            onChange={(e) =>
                              patchDelivery({
                                mode: e.target
                                  .value as Config["delivery"]["mode"],
                              })
                            }
                          >
                            <option value="single">整段发送</option>
                            <option value="natural">短句分条发送</option>
                          </select>
                        </label>
                        <label className="bridge-field">
                          一段回答最多拆成
                          <select
                            disabled={config.delivery.mode === "single"}
                            value={config.delivery.maxBubbles}
                            onChange={(e) =>
                              patchDelivery({
                                maxBubbles: Number(e.target.value),
                              })
                            }
                          >
                            <option value={2}>2 条消息</option>
                            <option value={3}>3 条消息</option>
                          </select>
                        </label>
                        <label className="bridge-field">
                          分条之间停顿
                          <select
                            disabled={config.delivery.mode === "single"}
                            value={config.delivery.pauseMs}
                            onChange={(e) =>
                              patchDelivery({ pauseMs: Number(e.target.value) })
                            }
                          >
                            {[
                              ...new Set([
                                500,
                                1200,
                                1800,
                                3000,
                                config.delivery.pauseMs,
                              ]),
                            ]
                              .sort((a, b) => a - b)
                              .map((n) => (
                                <option key={n} value={n}>
                                  {n / 1000} 秒
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="bridge-field">
                          接着问问题
                          <select
                            value={config.followUp}
                            onChange={(e) =>
                              update({
                                followUp: e.target.value as Config["followUp"],
                              })
                            }
                          >
                            <option value="rare">少追问，允许自然结束</option>
                            <option value="natural">
                              顺着话题，偶尔问一句
                            </option>
                            <option value="curious">
                              更好奇，但不连续盘问
                            </option>
                          </select>
                        </label>
                        <label className="bridge-field bridge-field-full">
                          括号动作与旁白
                          <select
                            value={config.actions}
                            onChange={(e) =>
                              update({
                                actions: e.target.value as Config["actions"],
                              })
                            }
                          >
                            <option value="off">
                              不用动作描写，像微信聊天
                            </option>
                            <option value="occasional">
                              角色扮演时偶尔使用
                            </option>
                          </select>
                        </label>
                        <label className="bridge-field bridge-field-full">
                          你喜欢的对话示例{" "}
                          <span className="bridge-field-optional">可选</span>
                          <textarea
                            rows={2}
                            maxLength={2000}
                            value={config.examples}
                            placeholder={
                              "对方：今天累死了。\n回复：那今天先到这儿。好好歇一会儿。"
                            }
                            onChange={(e) =>
                              update({ examples: e.target.value })
                            }
                          />
                        </label>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="bridge-behavior-toggle">
                        <span>
                          <strong>让 AI 偶尔先开口</strong>
                          <small>保存后启用，仅对下面选定的连接生效</small>
                        </span>
                        <input
                          type="checkbox"
                          checked={config.proactive.enabled}
                          onChange={(e) =>
                            patchProactive({ enabled: e.target.checked })
                          }
                        />
                      </label>
                      <div className="bridge-proactive-fields">
                        <label className="bridge-field">
                          安静多久后主动聊（分钟）
                          <input
                            type="number"
                            min="5"
                            max="1440"
                            value={config.proactive.intervalMinutes}
                            onChange={(e) =>
                              patchProactive({
                                intervalMinutes: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="bridge-field">
                          每个会话每天最多尝试
                          <select
                            value={config.proactive.dailyLimit}
                            onChange={(e) =>
                              patchProactive({
                                dailyLimit: Number(e.target.value),
                              })
                            }
                          >
                            {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                              <option key={n} value={n}>
                                {n} 次
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="bridge-field">
                          免打扰开始
                          <input
                            type="time"
                            value={config.proactive.quietStart}
                            onChange={(e) =>
                              patchProactive({ quietStart: e.target.value })
                            }
                          />
                        </label>
                        <label className="bridge-field">
                          免打扰结束
                          <input
                            type="time"
                            value={config.proactive.quietEnd}
                            onChange={(e) =>
                              patchProactive({ quietEnd: e.target.value })
                            }
                          />
                        </label>
                        <label className="bridge-field">
                          连续未回复时
                          <select
                            value={config.proactive.unansweredLimit}
                            onChange={(e) =>
                              patchProactive({
                                unansweredLimit: Number(e.target.value),
                              })
                            }
                          >
                            {[1, 2, 3].map((n) => (
                              <option key={n} value={n}>
                                尝试 {n} 次后停止，等我回复
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="bridge-field">
                          <span>用于哪些微信连接</span>
                          <div className="bridge-channel-choices">
                            {channels.isError ? (
                              <span role="alert">连接列表读取失败</span>
                            ) : wechat.length === 0 ? (
                              <Link to="/workspace/wechat">先连接微信 →</Link>
                            ) : (
                              wechat.map((ch, i) => (
                                <label key={ch.id}>
                                  <input
                                    type="checkbox"
                                    checked={config.proactive.channelIds.includes(
                                      ch.id,
                                    )}
                                    onChange={(e) =>
                                      patchProactive({
                                        channelIds: e.target.checked
                                          ? [
                                              ...config.proactive.channelIds,
                                              ch.id,
                                            ]
                                          : config.proactive.channelIds.filter(
                                              (id) => id !== ch.id,
                                            ),
                                      })
                                    }
                                  />
                                  微信连接 {i + 1}
                                </label>
                              ))
                            )}
                          </div>
                        </div>
                        <label className="bridge-field bridge-field-full">
                          希望它主动聊什么
                          <textarea
                            rows={2}
                            maxLength={2000}
                            value={config.proactive.prompt}
                            onChange={(e) =>
                              patchProactive({ prompt: e.target.value })
                            }
                          />
                        </label>
                      </div>
                    </>
                  )}
                </fieldset>
              </section>
              <aside className="bridge-behavior-aside">
                {tab === "chat" ? (
                  <>
                    <div className="bridge-chat-recipes">
                      <span className="bridge-eyebrow">MAKE IT YOURS</span>
                      <h2>从一种相处方式开始。</h2>
                      <p>选一个方案，微调后保存。</p>
                      {chatRecipes.map((recipe) => {
                        const active = Object.entries(recipe.settings).every(
                          ([key, value]) =>
                            JSON.stringify(config[key as keyof Config]) ===
                            JSON.stringify(value),
                        );
                        return (
                          <button
                            key={recipe.id}
                            type="button"
                            aria-pressed={active}
                            disabled={save.isPending}
                            onClick={() => update(recipe.settings)}
                          >
                            <span>
                              <strong>{recipe.name}</strong>
                              {active ? (
                                <Check size={14} />
                              ) : (
                                <ArrowUpRight size={14} />
                              )}
                            </span>
                            <small>{recipe.detail}</small>
                            <q>{recipe.sample}</q>
                          </button>
                        );
                      })}
                    </div>
                    <p className="bridge-behavior-hint">
                      示例不会发送；实际表达由当前模型决定。方案保留预设与自写示例，主动聊天和表情需另行开启。
                    </p>
                  </>
                ) : tab === "rhythm" ? (
                  <>
                    <div className="bridge-behavior-editorial bridge-rhythm-editorial">
                      <span className="bridge-eyebrow">ROOM TO BREATHE</span>
                      <MessagesSquare size={31} />
                      <h2>
                        不用每句话，
                        <br />
                        都有一个问号。
                      </h2>
                      <p>接住情绪、聊到哪儿算哪儿。需要帮忙时，再认真展开。</p>
                    </div>
                    <p className="bridge-behavior-hint">
                      示例会随聊天偏好发送给你配置的模型，用于学习表达方式，不作为共同记忆。适用于所有会话，请勿填写某个联系人的私密资料。
                    </p>
                    <p className="bridge-behavior-hint">
                      上下文沿用当前对话；新对话重新开始。本次不额外建立长期记忆。分条停顿不额外调用模型，暂停或发送失败会停止后续分条。
                    </p>
                  </>
                ) : (
                  <>
                    <div className="bridge-behavior-editorial">
                      <Clock3 size={31} />
                      <h2>
                        主动一点，
                        <br />
                        也留一点空间。
                      </h2>
                      <p>
                        按电脑本地时区运行。开始与结束相同表示不设免打扰。开启后会使用你的
                        API 额度。
                      </p>
                    </div>
                    <div className="bridge-proactive-status">
                      <strong>当前运行状态</strong>
                      {!query.data?.proactive?.enabled ? (
                        <p>尚未开启主动聊天</p>
                      ) : status.isError ? (
                        <p>暂时无法读取</p>
                      ) : (
                        (status.data ?? [])
                          .filter((s) =>
                            query.data?.proactive?.channelIds?.includes(
                              s.channelId,
                            ),
                          )
                          .map((s) => (
                            <p key={s.channelId}>
                              {!s.state
                                ? "等待运行服务与新消息"
                                : Date.now() - Date.parse(s.state.updatedAt) >
                                    180000
                                  ? "状态较旧，请检查本地服务"
                                  : statusLabels[s.state.status]}
                            </p>
                          ))
                      )}
                    </div>
                    <p className="bridge-behavior-hint">
                      重启后先在微信聊一句。微信会话凭据可能提前失效；发送失败后停止该会话的主动尝试，等新消息再恢复。
                    </p>
                  </>
                )}
              </aside>
            </div>
          )}
          <div className="bridge-behavior-save">
            {validationMessage ? (
              <span role="alert">{validationMessage}</span>
            ) : save.isSuccess ? (
              <output aria-live="polite" className="bridge-behavior-saved">
                <Check size={15} />
                已保存，下次回复或调度检查时生效。
              </output>
            ) : (
              <span>
                {draft ? "有未保存的修改" : "设置保存在本机"} ·
                首页暂停会同时暂停主动聊天
              </span>
            )}
            <button
              type="button"
              className="bridge-button"
              disabled={save.isPending || !draft || Boolean(validationMessage)}
              onClick={() => save.mutate()}
            >
              {save.isPending ? (
                <Loader2 size={16} className="bridge-spin" />
              ) : (
                <Save size={16} />
              )}
              保存行为设置
            </button>
          </div>
          {save.isError && (
            <p className="bridge-feedback is-error" role="alert">
              {errorMessage(save.error, "保存失败，请检查数值范围和本地服务。")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; title: string; detail: string }[];
}) {
  return (
    <fieldset className="bridge-behavior-choice">
      <legend>{label}</legend>
      <div>
        {options.map((option) => (
          <label
            className={value === option.value ? "is-selected" : ""}
            key={option.value}
          >
            <input
              type="radio"
              name={label}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <strong>{option.title}</strong>
            <small>{option.detail}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function StickerLibrary({
  items,
  loading,
  error,
}: {
  items: { id: string; label: string; tags: string }[];
  loading: boolean;
  error: boolean;
}) {
  const cache = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [tags, setTags] = useState("");
  const [page, setPage] = useState(0);
  const [localError, setLocalError] = useState("");
  const upload = useMutation({
    mutationFn: async () => {
      if (
        !file ||
        file.size > 2 * 1024 * 1024 ||
        !["image/png", "image/jpeg", "image/gif"].includes(file.type)
      )
        throw new Error("请选择 2 MB 以内的 PNG、JPEG 或 GIF 图片。");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("图片读取失败。"));
        reader.readAsDataURL(file);
      });
      return (
        await postApiV1BridgeStickers({
          body: { label, tags, data },
          throwOnError: true,
        })
      ).data;
    },
    onSuccess: (data) => {
      cache.setQueryData(["bridge-stickers"], data);
      setFile(null);
      setLabel("");
      setTags("");
      if (fileInput.current) fileInput.current.value = "";
      setPage(Math.floor(Math.max(0, (data?.length ?? 1) - 1) / 4));
    },
    onError: (error) =>
      setLocalError(
        errorMessage(
          error,
          error instanceof Error ? error.message : "导入失败，请检查本地服务。",
        ),
      ),
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      (
        await deleteApiV1BridgeStickersById({
          path: { id },
          throwOnError: true,
        })
      ).data,
    onSuccess: (data) => cache.setQueryData(["bridge-stickers"], data),
  });
  const current = Math.min(page, Math.max(0, Math.ceil(items.length / 4) - 1));
  const base = String(client.getConfig().baseUrl ?? "");
  return (
    <>
      <div className="bridge-sticker-heading">
        <h2>你的表情小收藏</h2>
        <span>{items.length} / 24</span>
      </div>
      {error ? (
        <p role="alert">图库读取失败，请刷新页面。</p>
      ) : loading ? (
        <p>正在读取图库…</p>
      ) : items.length === 0 ? (
        <div className="bridge-sticker-empty">
          <ImagePlus size={32} />
          <h3>放进你喜欢的表情。</h3>
          <p>写上「开心、赞同、安慰」等标签，AI 才知道什么时候用。</p>
        </div>
      ) : (
        <div className="bridge-sticker-grid">
          {items.slice(current * 4, current * 4 + 4).map((item) => (
            <article key={item.id}>
              <img
                src={`${base}/api/v1/bridge/stickers/${item.id}/image`}
                alt={item.label}
              />
              <div>
                <strong>{item.label}</strong>
                <span title={item.tags}>{item.tags}</span>
              </div>
              <button
                type="button"
                aria-label={`移除 ${item.label}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(item.id)}
              >
                <Trash2 size={14} />
              </button>
            </article>
          ))}
        </div>
      )}
      {items.length > 4 && (
        <div className="bridge-pagination">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </button>
          <span>
            {current + 1} / {Math.ceil(items.length / 4)}
          </span>
          <button
            type="button"
            disabled={(current + 1) * 4 >= items.length}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </button>
        </div>
      )}
      <form
        className="bridge-sticker-upload"
        onSubmit={(e) => {
          e.preventDefault();
          setLocalError("");
          upload.mutate();
        }}
      >
        <fieldset disabled={upload.isPending || error || items.length >= 24}>
          <label className="bridge-file-picker">
            <ImagePlus size={17} />
            <span>
              {file?.name ?? "选择图片 · PNG / JPEG / GIF · 最大 2 MB"}
            </span>
            <input
              ref={fileInput}
              aria-label="选择表情图片"
              type="file"
              accept="image/png,image/jpeg,image/gif"
              required
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setLocalError("");
              }}
            />
          </label>
          <div>
            <input
              aria-label="表情名称"
              placeholder="名称，如：开心鼓掌"
              maxLength={30}
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              aria-label="适用场景标签"
              placeholder="适用场景，如：开心、赞同"
              maxLength={120}
              required
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <button className="bridge-button bridge-button-small" type="submit">
              {upload.isPending ? "导入中…" : "导入"}
            </button>
          </div>
        </fieldset>
      </form>
      <p className="bridge-behavior-hint">
        只导入你有权使用的图片。导入仅存本机；AI
        选择发送时才上传微信。图片内容不发送给模型，仅提供名称和标签。
      </p>
      {localError && (
        <p role="alert" className="bridge-feedback is-error">
          {localError}
        </p>
      )}
      {remove.isError && <p role="alert">移除失败，请重试。</p>}
    </>
  );
}
