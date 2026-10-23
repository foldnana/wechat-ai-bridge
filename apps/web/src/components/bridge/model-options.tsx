import type { PostApiV1BridgeModelsDiscoverResponse } from "../../../lib/api/types.gen";

export type ModelOptions = {
  thinking: "auto" | "off" | "low" | "high" | "max";
  timeoutSeconds: number;
  retries: number;
};
export const defaultModelOptions: ModelOptions = {
  thinking: "auto",
  timeoutSeconds: 90,
  retries: 1,
};

export function ModelDescription({
  model,
  result,
  current = false,
}: {
  model: string;
  result: PostApiV1BridgeModelsDiscoverResponse | null | undefined;
  current?: boolean;
}) {
  const detail = result?.details?.find((item) => item.id === model);
  return (
    <div
      className="bridge-model-description bridge-field-full"
      aria-live="polite"
    >
      {current &&
        result?.ok &&
        !result.incomplete &&
        !result.models.includes(model) && (
          <p className="bridge-model-warning">
            当前模型不在服务商最新列表中，可能是旧名称或权限变化；已保留配置，可选择列表中的模型测试后切换。
          </p>
        )}
      {detail?.name && <strong>{detail.name}</strong>}
      {detail && (
        <p>
          {[
            detail.context_window
              ? `服务商上下文上限 ${detail.context_window.toLocaleString()} tokens`
              : null,
            detail.max_output_tokens
              ? `输出上限 ${detail.max_output_tokens.toLocaleString()} tokens`
              : null,
            detail.input_modalities?.includes("image")
              ? "模型支持图片输入（不代表微信图片功能已接通）"
              : null,
            detail.effort?.supported_levels?.length ? "支持思考强度控制" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "服务商仅返回模型名称，其他能力需以其说明为准。"}
        </p>
      )}
      <p>这里只列出当前 API 可见的模型。其他厂商的模型需要配置对应 API。</p>
    </div>
  );
}

export function ModelAdvancedOptions({
  value,
  onChange,
  deepseekOfficial,
  model,
}: {
  value: ModelOptions;
  onChange: (value: ModelOptions) => void;
  deepseekOfficial: boolean;
  model: string;
}) {
  const thinkingSupported =
    deepseekOfficial && ["deepseek-flash", "deepseek-v4-pro"].includes(model);
  return (
    <details className="bridge-model-advanced bridge-field-full">
      <summary>
        高级设置 <span>思考模式 · 超时 · 重试</span>
      </summary>
      <div className="bridge-form-fields">
        <div className="bridge-field bridge-field-full">
          <label>
            思考模式
            <select
              aria-label="思考模式"
              value={thinkingSupported ? value.thinking : "auto"}
              disabled={!thinkingSupported}
              onChange={(e) =>
                onChange({
                  ...value,
                  thinking: e.target.value as ModelOptions["thinking"],
                })
              }
            >
              <option value="auto">服务商默认</option>
              <option value="off">关闭思考（更快回复）</option>
              <option value="low">轻度思考</option>
              <option value="high">深入思考</option>
              <option value="max">最高强度</option>
            </select>
          </label>
          <p className="bridge-field-hint">
            {thinkingSupported
              ? "思考越深入，等待和用量通常越多；默认模式由服务商决定。"
              : "此模型或接口暂未验证思考控制，保留服务商默认，避免请求不兼容。"}
          </p>
        </div>
        <div className="bridge-field">
          <label>
            请求时限
            <select
              aria-label="请求时限"
              value={value.timeoutSeconds}
              onChange={(e) =>
                onChange({ ...value, timeoutSeconds: Number(e.target.value) })
              }
            >
              {[30, 60, 90, 120, 180].map((n) => (
                <option key={n} value={n}>
                  {n} 秒{n === 90 ? "（默认）" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="bridge-field">
          <label>
            网络重试
            <select
              aria-label="网络重试"
              value={value.retries}
              onChange={(e) =>
                onChange({ ...value, retries: Number(e.target.value) })
              }
            >
              <option value={0}>不自动重试</option>
              <option value={1}>最多 1 次（默认）</option>
              <option value={2}>最多 2 次</option>
            </select>
          </label>
        </div>
        <p className="bridge-form-disclosure">
          时限包含单次模型请求及其网络重试。只在连接异常、限流或临时服务错误时重试；已经开始返回的回答不会重发。重试可能增加用量。
        </p>
        <button
          type="button"
          className="bridge-text-button"
          onClick={() => onChange({ ...defaultModelOptions })}
        >
          恢复高级设置默认值
        </button>
      </div>
    </details>
  );
}
