import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, RefreshCw, Save, UsersRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteApiV1BridgeContactsByIdMemories,
  getApiV1BridgeContacts,
  getApiV1BridgeContactsById,
  putApiV1BridgeContactsById,
} from "../../lib/api/sdk.gen";
import type { GetApiV1BridgeContactsByIdResponse } from "../../lib/api/types.gen";
import "../lib/api";

type Settings = Required<GetApiV1BridgeContactsByIdResponse["settings"]>;
const defaults: Settings = {
  label: "",
  nickname: "",
  relationship: "",
  instructions: "",
  memoryEnabled: false,
  memories: [],
  proactive: "inherit",
  topicMode: "inherit",
};
const sections = [
  { id: "profile", label: "相处方式" },
  { id: "memory", label: "记住哪些事" },
  { id: "proactive", label: "主动联系" },
] as const;
function message(error: unknown) {
  return error &&
    typeof error === "object" &&
    "error" in error &&
    typeof error.error === "string"
    ? error.error
    : "操作未完成，请检查本地服务后重试。";
}
export function ContactsPage() {
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  const [page, setPage] = useState(0);
  const contacts = useQuery({
    queryKey: ["bridge-contacts"],
    queryFn: async () =>
      (await getApiV1BridgeContacts({ throwOnError: true })).data,
  });
  const list = contacts.data ?? [];
  const current = list.find((c) => c.id === selected) ?? list[0];
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(list.length / 5) - 1),
  );
  return (
    <div className="bridge-page bridge-contacts-page">
      <header className="bridge-page-heading">
        <div>
          <span className="bridge-eyebrow">
            EVERY CONVERSATION IS DIFFERENT
          </span>
          <h1>记得你，也懂怎么陪你。</h1>
          <p>每个微信会话独立设置，记住的内容由你决定。</p>
        </div>
        <Link className="bridge-back-link" to="/workspace/behavior">
          <ArrowLeft size={15} />
          聊天行为
        </Link>
      </header>
      {contacts.isError ? (
        <div className="bridge-feedback is-error" role="alert">
          {message(contacts.error)}{" "}
          <button type="button" onClick={() => void contacts.refetch()}>
            重新读取
          </button>
        </div>
      ) : contacts.isPending ? (
        <output>正在读取本机会话…</output>
      ) : !current ? (
        <section className="bridge-panel bridge-contacts-empty">
          <UsersRound size={36} />
          <h2>从一次聊天开始认识。</h2>
          <p>
            已连接微信后，发一条消息，再刷新这里。只有通过授权的会话才会出现；不会读取微信通讯录。
          </p>
          <div>
            <button
              type="button"
              className="bridge-button"
              onClick={() => void contacts.refetch()}
            >
              <RefreshCw size={15} />
              刷新会话
            </button>
            <Link className="bridge-back-link" to="/workspace/wechat">
              查看微信连接
            </Link>
          </div>
        </section>
      ) : (
        <div className="bridge-contacts-columns">
          <aside className="bridge-panel bridge-contact-list">
            <div className="bridge-contact-list-heading">
              <strong>本机会话 · {list.length}</strong>
              <button
                type="button"
                aria-label="刷新会话"
                disabled={dirty || contacts.isFetching}
                onClick={() => void contacts.refetch()}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {list.slice(currentPage * 5, currentPage * 5 + 5).map((c) => (
              <button
                type="button"
                className="bridge-contact-item"
                key={c.id}
                aria-pressed={current.id === c.id}
                disabled={dirty && current.id !== c.id}
                onClick={() => setSelected(c.id)}
              >
                <span className="bridge-contact-avatar">
                  {c.label.slice(0, 1)}
                </span>
                <span>
                  <strong>{c.label}</strong>
                  <small>
                    {c.memoryEnabled
                      ? `${c.memoryCount} 条已启用记忆`
                      : "记忆未启用"}
                  </small>
                </span>
              </button>
            ))}
            {list.length > 5 && (
              <div className="bridge-pagination">
                <button
                  type="button"
                  disabled={dirty || currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  上一页
                </button>
                <span>
                  {currentPage + 1}/{Math.ceil(list.length / 5)}
                </span>
                <button
                  type="button"
                  disabled={dirty || (currentPage + 1) * 5 >= list.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  下一页
                </button>
              </div>
            )}
            <p className="bridge-behavior-hint">
              名称可以自行备注。新开对话保留这里的资料与记忆。
            </p>
          </aside>
          <ContactEditor
            key={current.id}
            id={current.id}
            label={current.label}
            onDirty={setDirty}
          />
        </div>
      )}
    </div>
  );
}
function ContactEditor({
  id,
  label,
  onDirty,
}: { id: string; label: string; onDirty: (dirty: boolean) => void }) {
  const cache = useQueryClient();
  const [section, setSection] =
    useState<(typeof sections)[number]["id"]>("profile");
  const [draft, setDraft] = useState<{
    revision: string;
    settings: Settings;
  } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const query = useQuery({
    queryKey: ["bridge-contact", id],
    queryFn: async () =>
      (await getApiV1BridgeContactsById({ path: { id }, throwOnError: true }))
        .data,
  });
  const current = draft ?? {
    revision: query.data?.revision ?? "initial",
    settings: { ...defaults, ...query.data?.settings },
  };
  const s = current.settings;
  const accept = (data: GetApiV1BridgeContactsByIdResponse | undefined) => {
    cache.setQueryData(["bridge-contact", id], data);
    setDraft(null);
    onDirty(false);
    setConfirmClear(false);
    void cache.invalidateQueries({ queryKey: ["bridge-contacts"] });
  };
  const save = useMutation({
    mutationFn: async () =>
      (
        await putApiV1BridgeContactsById({
          path: { id },
          body: {
            ...current,
            settings: {
              ...s,
              memories: s.memories.map((m) => m.trim()).filter(Boolean),
            },
          },
          throwOnError: true,
        })
      ).data,
    onSuccess: accept,
  });
  const clear = useMutation({
    mutationFn: async () =>
      (
        await deleteApiV1BridgeContactsByIdMemories({
          path: { id },
          throwOnError: true,
        })
      ).data,
    onSuccess: accept,
  });
  const update = (patch: Partial<Settings>) => {
    setDraft({ ...current, settings: { ...s, ...patch } });
    onDirty(true);
    save.reset();
    clear.reset();
    setConfirmClear(false);
  };
  const invalid =
    s.memories.filter((m) => m.trim()).length > 20 ||
    s.memories.some((m) => m.length > 300);
  const busy = save.isPending || clear.isPending;
  return (
    <section className="bridge-panel bridge-contact-editor">
      <nav className="bridge-behavior-tabs" aria-label="联系人设置分类">
        {sections.map((tab) => (
          <button
            type="button"
            key={tab.id}
            aria-current={section === tab.id ? "page" : undefined}
            onClick={() => {
              setSection(tab.id);
              setConfirmClear(false);
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {query.isPending ? (
        <output>正在读取资料…</output>
      ) : query.isError ? (
        <p role="alert">
          {message(query.error)}{" "}
          <button type="button" onClick={() => void query.refetch()}>
            重新读取
          </button>
        </p>
      ) : (
        <>
          <fieldset disabled={busy} className="bridge-contact-fields">
            {section === "profile" ? (
              <>
                <h2>{label}的相处方式</h2>
                <div className="bridge-proactive-fields">
                  <label className="bridge-field">
                    本地备注名
                    <input
                      maxLength={40}
                      value={s.label}
                      placeholder="如：我的微信"
                      onChange={(e) => update({ label: e.target.value })}
                    />
                  </label>
                  <label className="bridge-field">
                    希望 AI 怎么称呼对方
                    <input
                      maxLength={40}
                      value={s.nickname}
                      placeholder="留空，让它自然称呼"
                      onChange={(e) => update({ nickname: e.target.value })}
                    />
                  </label>
                  <label className="bridge-field bridge-field-full">
                    彼此是什么关系
                    <input
                      maxLength={200}
                      value={s.relationship}
                      placeholder="如：熟悉的朋友，可以轻松开玩笑"
                      onChange={(e) => update({ relationship: e.target.value })}
                    />
                  </label>
                  <label className="bridge-field bridge-field-full">
                    这个会话专属的聊天习惯
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={s.instructions}
                      placeholder="如：我吐槽时先听我说，等我问你再给建议。"
                      onChange={(e) => update({ instructions: e.target.value })}
                    />
                  </label>
                </div>
                <p className="bridge-behavior-hint">
                  本地备注名仅用于列表。称呼、关系和聊天习惯会发送给你配置的模型，仅用于这个会话；整体人设仍在「回答风格」编辑。
                </p>
              </>
            ) : section === "memory" ? (
              <>
                <label className="bridge-behavior-toggle">
                  <span>
                    <strong>允许使用这些记忆</strong>
                    <small>只使用你在下方明确保存的内容</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={s.memoryEnabled}
                    onChange={(e) =>
                      update({ memoryEnabled: e.target.checked })
                    }
                  />
                </label>
                <label className="bridge-field">
                  想让它记住的事 · 每行一条
                  <textarea
                    className="bridge-memory-input"
                    rows={6}
                    maxLength={6020}
                    value={s.memories.join("\n")}
                    placeholder={
                      "喜欢聊电影，不喜欢剧透。\n工作日晚上通常比较忙。"
                    }
                    onChange={(e) =>
                      update({ memories: e.target.value.split("\n") })
                    }
                  />
                </label>
                <p className="bridge-behavior-hint">
                  最多 20 条，每条 300
                  字。可直接修改或删除某一行，保存后生效。不会自动提取聊天记录，启用后相关内容会随请求发送给模型。
                </p>
                <div className="bridge-contact-clear">
                  {confirmClear ? (
                    <>
                      <span>
                        清空本机保存的记忆并关闭使用？不删除聊天记录或服务商数据。
                      </span>
                      <button type="button" onClick={() => clear.mutate()}>
                        确定清空记忆
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClear(false)}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        Boolean(draft) ||
                        !query.data?.settings.memories?.length
                      }
                      onClick={() => setConfirmClear(true)}
                    >
                      {draft
                        ? "先保存或放弃修改，再清空记忆"
                        : "清空已保存记忆"}
                    </button>
                  )}
                </div>
                <p className="bridge-behavior-hint">
                  旧对话仍可能提及这些事；需要从空白上下文开始，请另到
                  <Link to="/workspace/sessions">对话管理新开对话</Link>
                  。清空不会删除其他资料。
                </p>
              </>
            ) : (
              <>
                <h2>主动一点，也尊重对方的时间。</h2>
                <div className="bridge-proactive-fields">
                  <label className="bridge-field bridge-field-full">
                    这个会话可以被主动联系吗
                    <select
                      value={s.proactive}
                      onChange={(e) =>
                        update({
                          proactive: e.target.value as Settings["proactive"],
                        })
                      }
                    >
                      <option value="inherit">跟随全局主动聊天开关</option>
                      <option value="off">不主动联系这个会话</option>
                    </select>
                  </label>
                  <label className="bridge-field bridge-field-full">
                    主动聊天的内容
                    <select
                      value={s.topicMode}
                      onChange={(e) =>
                        update({
                          topicMode: e.target.value as Settings["topicMode"],
                        })
                      }
                    >
                      <option value="inherit">跟随全局话题设置</option>
                      <option value="recent">
                        接着近期话题，相关时参考已启用记忆
                      </option>
                      <option value="greeting">轻量问候，不主动翻旧话题</option>
                    </select>
                  </label>
                </div>
                <p className="bridge-behavior-hint">
                  仍受全局间隔、免打扰、每日上限和未回复上限约束。新消息到来会取消正在准备的主动问候；识别到「晚安」「别打扰」等结束语后，等对方再次发消息才恢复。
                </p>
                <Link
                  className="bridge-back-link"
                  to="/workspace/behavior?tab=proactive"
                >
                  调整全局主动程度 →
                </Link>
              </>
            )}
          </fieldset>
          {invalid && (
            <p className="bridge-feedback is-error" role="alert">
              记忆最多 20 条，每条不超过 300 字。
            </p>
          )}
          {(save.isError || clear.isError) && (
            <p className="bridge-feedback is-error" role="alert">
              {message(save.error ?? clear.error)}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  onDirty(false);
                  save.reset();
                  clear.reset();
                  void query.refetch();
                }}
              >
                放弃修改并重新读取
              </button>
            </p>
          )}
          <div className="bridge-behavior-save">
            <span>
              {draft ? (
                "此会话有未保存的修改"
              ) : save.isSuccess || clear.isSuccess ? (
                <>
                  <Check size={13} />
                  已保存，下次生成使用新设置
                </>
              ) : (
                "设置只对当前会话生效"
              )}
            </span>
            <div>
              {draft && (
                <button
                  type="button"
                  className="bridge-back-link"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    onDirty(false);
                    save.reset();
                  }}
                >
                  放弃修改
                </button>
              )}
              <button
                type="button"
                className="bridge-button"
                disabled={!draft || busy || invalid}
                onClick={() => save.mutate()}
              >
                <Save size={15} />
                {busy ? "正在保存…" : "保存会话设置"}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
