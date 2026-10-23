import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  getApiV1BridgeModelsSaved,
  postApiV1BridgeModel,
} from "../../../lib/api/sdk.gen";
import type { GetApiV1BridgeModelsSavedResponse } from "../../../lib/api/types.gen";
import { useModelDiscovery } from "../../hooks/use-model-discovery";
import {
  ModelAdvancedOptions,
  ModelDescription,
  type ModelOptions,
  defaultModelOptions,
} from "./model-options";

type Connection = GetApiV1BridgeModelsSavedResponse["connections"][number];
export function SavedModelConnection({
  data,
  onConfigure,
}: { data: GetApiV1BridgeModelsSavedResponse; onConfigure: () => void }) {
  const [providerKey, setProviderKey] = useState(
    data.selectedProviderKey ?? data.connections[0]?.id ?? "",
  );
  const connection =
    data.connections.find((item) => item.id === providerKey) ??
    data.connections[0];
  const [switching, setSwitching] = useState(false);
  if (!connection) return null;
  return (
    <>
      <div className="bridge-field">
        <label htmlFor="bridge-saved-api">
          已保存 API <span>使用本机已保存的密钥，无需重复填写</span>
        </label>
        <select
          id="bridge-saved-api"
          value={connection.id}
          disabled={switching}
          onChange={(event) => setProviderKey(event.target.value)}
        >
          {data.connections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <SavedModelPicker
        key={connection.id}
        connection={connection}
        currentModel={data.currentModel}
        onSwitching={setSwitching}
      />
      <button
        type="button"
        className="bridge-text-button"
        disabled={switching}
        onClick={onConfigure}
      >
        更换密钥或配置其他 API
      </button>
    </>
  );
}

function SavedModelPicker({
  connection,
  currentModel,
  onSwitching,
}: {
  connection: Connection;
  currentModel: string | null;
  onSwitching: (value: boolean) => void;
}) {
  const cache = useQueryClient();
  const { discover, reset, result, loading } = useModelDiscovery();
  const currentId = currentModel?.startsWith(`${connection.id}/`)
    ? currentModel.slice(connection.id.length + 1)
    : "";
  const [model, setModel] = useState(currentId);
  const [manual, setManual] = useState(false);
  const [draftOptions, setDraftOptions] = useState<
    Record<string, ModelOptions>
  >({});
  const savedOptions = connection.modelOptions?.[model] ?? defaultModelOptions;
  const modelOptions = draftOptions[model] ?? savedOptions;
  useEffect(() => {
    let active = true;
    reset();
    void discover({
      savedProviderKey: connection.id,
      revision: connection.revision,
    }).then((data) => {
      if (active && data?.ok) setModel(currentId || data.models[0] || "");
    });
    return () => {
      active = false;
    };
  }, [connection.id, connection.revision, currentId, discover, reset]);
  const options = [
    ...new Set([...(currentId ? [currentId] : []), ...(result?.models ?? [])]),
  ];
  const canSwitch =
    !loading &&
    Boolean(model.trim()) &&
    (model !== currentId ||
      JSON.stringify(modelOptions) !== JSON.stringify(savedOptions)) &&
    (manual || options.includes(model));
  const mutation = useMutation({
    mutationFn: async () => {
      onSwitching(true);
      return (
        await postApiV1BridgeModel({
          body: {
            savedProviderKey: connection.id,
            revision: connection.revision,
            model,
            options: modelOptions,
          },
          signal: AbortSignal.timeout(
            (modelOptions.timeoutSeconds + 60) * 1000,
          ),
          throwOnError: true,
        })
      ).data;
    },
    onSuccess: (data) => {
      if (data?.saved) {
        void cache.invalidateQueries({ queryKey: ["desktop-default-model"] });
        void cache.invalidateQueries({ queryKey: ["models"] });
        void cache.invalidateQueries({ queryKey: ["bridge-saved-models"] });
      }
    },
    onSettled: () => onSwitching(false),
  });
  async function refresh() {
    const data = await discover({
      savedProviderKey: connection.id,
      revision: connection.revision,
    });
    if (data?.ok && !manual && !model)
      setModel(currentId || data.models[0] || "");
  }
  return (
    <form
      className="bridge-saved-model-picker"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSwitch) mutation.mutate();
      }}
    >
      <fieldset className="bridge-form-fields" disabled={mutation.isPending}>
        <div className="bridge-field bridge-field-full">
          <label htmlFor="bridge-saved-model">
            切换模型{" "}
            <button
              type="button"
              className="bridge-text-button"
              onClick={() => {
                if (loading) reset();
                setManual(!manual);
                mutation.reset();
              }}
            >
              {manual ? "从列表选择" : "手动填写"}
            </button>
          </label>
          {manual ? (
            <input
              id="bridge-saved-model"
              required
              maxLength={200}
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                mutation.reset();
              }}
              placeholder="服务商提供的模型 ID"
            />
          ) : (
            <select
              id="bridge-saved-model"
              value={options.includes(model) ? model : ""}
              disabled={loading || !options.length}
              onChange={(event) => {
                setModel(event.target.value);
                mutation.reset();
              }}
            >
              <option value="" disabled>
                {loading ? "正在读取…" : "请选择模型"}
              </option>
              {options.map((id) => (
                <option key={id} value={id}>
                  {id}
                  {id === currentId ? "（当前模型）" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="bridge-model-discovery bridge-field-full">
          <button
            type="button"
            className="bridge-text-button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "正在读取模型…" : "刷新模型列表"}
          </button>
          <output aria-live="polite">
            {result?.message ?? "使用已保存 API 读取模型列表。"}
          </output>
          {result?.code === "config_changed" && (
            <button
              type="button"
              className="bridge-text-button"
              onClick={() =>
                void cache.fetchQuery({
                  queryKey: ["bridge-saved-models"],
                  queryFn: async () =>
                    (await getApiV1BridgeModelsSaved({ throwOnError: true }))
                      .data,
                })
              }
            >
              重新读取已保存 API
            </button>
          )}
        </div>
        <ModelDescription
          model={model}
          result={result}
          current={model === currentId}
        />
        <ModelAdvancedOptions
          model={model}
          deepseekOfficial={Boolean(connection.deepseekOfficial)}
          value={modelOptions}
          onChange={(value) => {
            setDraftOptions((prev) => ({ ...prev, [model]: value }));
            mutation.reset();
          }}
        />
        <p className="bridge-form-disclosure">
          切换会测试新模型，产生少量 API
          用量。现有会话、预设和联系人记忆保留；后台会重新连接，建议等当前回复结束后再切换。
        </p>
        <button
          type="submit"
          className="bridge-button bridge-button-wide"
          disabled={!canSwitch}
        >
          {mutation.isPending
            ? "正在测试并切换…"
            : model === currentId && canSwitch
              ? "测试并保存设置"
              : "测试并切换模型"}
        </button>
      </fieldset>
      {mutation.data && (
        <output
          className={`bridge-feedback ${mutation.data.ok ? "is-success" : "is-error"}`}
        >
          {mutation.data.message}
        </output>
      )}
      {mutation.isError && (
        <p role="alert" className="bridge-feedback is-error">
          未能确认切换结果，请刷新查看当前模型后重试。
        </p>
      )}
    </form>
  );
}
