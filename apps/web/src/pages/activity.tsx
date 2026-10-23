import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Clock3,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { getApiV1BridgeActivity } from "../../lib/api/sdk.gen";

export function ActivityPage() {
  const [page, setPage] = useState(0);
  const activity = useQuery({
    queryKey: ["bridge-activity"],
    queryFn: async () =>
      (await getApiV1BridgeActivity({ throwOnError: true })).data,
    refetchInterval: 3000,
  });
  const entries =
    activity.data?.activities.filter((entry) => entry.activity) ?? [];
  const pages = Math.max(1, Math.ceil(entries.length / 2));
  const current = Math.min(page, pages - 1);
  return (
    <div className="bridge-page bridge-activity-page">
      <header className="bridge-page-heading">
        <div>
          <span className="bridge-eyebrow">收发状态</span>
          <h1>运行记录</h1>
          <p>查看每条连接最近一次处理状态，不记录聊天正文。</p>
        </div>
        <button
          type="button"
          className="bridge-button bridge-button-secondary bridge-button-small"
          onClick={() => void activity.refetch()}
        >
          <RefreshCw
            size={15}
            className={activity.isFetching ? "bridge-spin" : ""}
          />
          刷新记录
        </button>
      </header>
      <section className="bridge-panel bridge-activity-board">
        <div className="bridge-board-heading">
          <h2>最近处理记录</h2>
          <span>
            <span className="bridge-dot" />每 3 秒自动更新
          </span>
        </div>
        {activity.isError ? (
          <div className="bridge-record-empty">
            <RefreshCw size={32} />
            <h3>暂时无法读取记录</h3>
            <p>请检查本地服务后重新刷新。</p>
          </div>
        ) : activity.isPending ? (
          <div className="bridge-record-empty">
            <Clock3 size={32} />
            <h3>正在读取记录…</h3>
          </div>
        ) : entries.length === 0 ? (
          <div className="bridge-record-empty">
            <div className="bridge-record-orbit" aria-hidden="true">
              <MessageCircle size={38} strokeWidth={1.2} />
            </div>
            <span className="bridge-eyebrow">暂无处理记录</span>
            <h3>尚未处理微信消息</h3>
            <p>去微信聊聊，收到消息、生成回答和发送的状态会显示在这里。</p>
            <Link to="/workspace/wechat" className="bridge-text-button">
              查看微信连接 <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <div className="bridge-record-list">
            {entries.slice(current * 2, current * 2 + 2).map(
              ({ channelId, activity: item }, index) =>
                item && (
                  <article key={channelId} className="bridge-record">
                    <div className="bridge-record-title">
                      <span>微信连接 · {current * 2 + index + 1}</span>
                      <time>{new Date(item.receivedAt).toLocaleString()}</time>
                      <span
                        className={`bridge-badge ${item.error ? "" : item.sentAt ? "is-success" : ""}`}
                      >
                        {item.error
                          ? "需要处理"
                          : item.cancelled
                            ? "已停止"
                            : item.sentAt
                              ? "已发送"
                              : "处理中"}
                      </span>
                    </div>
                    <div className="bridge-record-stages">
                      {[
                        {
                          title:
                            item.trigger === "proactive"
                              ? "主动聊天触发"
                              : "收到消息",
                          time: item.receivedAt,
                        },
                        { title: "生成回答", time: item.generatedAt },
                        { title: "微信接受发送", time: item.sentAt },
                      ].map((step, i) => (
                        <div
                          className={step.time ? "is-complete" : ""}
                          key={step.title}
                        >
                          <span>{step.time ? <Check size={16} /> : i + 1}</span>
                          <div>
                            <strong>{step.title}</strong>
                            <small>
                              {step.time
                                ? new Date(step.time).toLocaleTimeString()
                                : "暂无记录"}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                    {item.cancelled && (
                      <p className="bridge-muted">
                        本次回复因暂停、退出或会话设置变化已停止，已发出的内容无法撤回。
                      </p>
                    )}
                    {item.warning === "sticker" && (
                      <p className="bridge-muted">
                        回答已发送，附带表情未发出。无需重发这条消息。
                      </p>
                    )}
                    {item.error && (
                      <p role="alert" className="bridge-feedback is-error">
                        {item.error === "generation"
                          ? "模型处理失败，请检查 API、额度与模型设置。"
                          : "发送失败，请检查微信授权与网络。"}
                        <Link
                          to={
                            item.error === "generation"
                              ? "/workspace/models"
                              : "/workspace/wechat"
                          }
                        >
                          前往检查 <ArrowRight size={13} />
                        </Link>
                      </p>
                    )}
                    {item.lastSuccessfulReplyAt && (
                      <p className="bridge-muted">
                        最近成功发送：
                        {new Date(item.lastSuccessfulReplyAt).toLocaleString()}
                      </p>
                    )}
                  </article>
                ),
            )}
          </div>
        )}
        <footer className="bridge-board-footer">
          <p>“已发送”表示微信接受请求，实际回复请在手机上查看。</p>
          {pages > 1 && (
            <div className="bridge-pagination">
              <button
                type="button"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                上一页
              </button>
              <span>
                {current + 1} / {pages}
              </span>
              <button
                type="button"
                disabled={current === pages - 1}
                onClick={() => setPage(current + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
