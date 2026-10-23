import { useQuery } from "@tanstack/react-query";
import { Check, Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { getApiInternalDesktopDefaultModel } from "../../../lib/api/sdk.gen";
import {
  BRIDGE_THEMES,
  readBridgeTheme,
  readFollowModel,
  resolveBridgeTheme,
} from "../../lib/bridge-theme";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";

export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(readBridgeTheme);
  const [followModel, setFollowModel] = useState(readFollowModel);
  const model = useQuery({
    queryKey: ["desktop-default-model"],
    queryFn: async () =>
      (await getApiInternalDesktopDefaultModel({ throwOnError: true })).data,
  });
  // Whale is the default palette; following the model is an optional preference.
  const effective = resolveBridgeTheme(
    selected,
    followModel,
    model.data?.modelId,
  );
  useEffect(() => {
    document.documentElement.dataset.bridgeTheme = effective;
    try {
      localStorage.setItem("bridge-theme", selected);
      localStorage.setItem(
        "bridge-theme-follow-model",
        followModel ? "on" : "off",
      );
    } catch {
      // The palette still works when optional preference storage is unavailable.
    }
  }, [selected, effective, followModel]);
  return (
    <>
      <button
        type="button"
        className="bridge-theme-trigger"
        onClick={() => setOpen(true)}
        aria-expanded={open}
      >
        <Palette size={17} />
        <span>配色</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bridge-dialog">
          <span className="bridge-eyebrow">界面设置</span>
          <DialogTitle className="bridge-dialog-title">选择配色</DialogTitle>
          <DialogDescription className="bridge-dialog-description">
            默认使用大肥鱼蓝，与所选模型无关。也可以换一种配色，下次打开会记住。
          </DialogDescription>
          <label className="bridge-theme-auto">
            <input
              type="checkbox"
              checked={followModel}
              onChange={(event) => setFollowModel(event.target.checked)}
            />
            <span>
              跟随模型切换
              <span>
                首次配置与 DeepSeek 使用鲸鱼主题；其他模型使用上次选的配色。
              </span>
            </span>
          </label>
          <fieldset className="bridge-theme-options">
            <legend className="sr-only">界面配色</legend>
            {BRIDGE_THEMES.map((theme) => (
              <label
                key={theme.id}
                className={`bridge-theme-option ${effective === theme.id ? "is-selected" : ""}`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="bridge-theme"
                  value={theme.id}
                  checked={effective === theme.id}
                  onChange={() => {
                    setSelected(theme.id);
                    setFollowModel(false);
                  }}
                />
                <span
                  className="bridge-theme-swatch"
                  style={{ background: theme.paper, color: theme.ink }}
                >
                  <span style={{ background: theme.ink }} />
                  <span style={{ background: theme.ink }} />
                  {effective === theme.id && <Check size={17} />}
                </span>
                <strong>{theme.name}</strong>
                <span>{theme.description}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="bridge-button bridge-button-wide"
            onClick={() => setOpen(false)}
          >
            完成
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
