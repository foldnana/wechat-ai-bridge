import { Check, Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { BRIDGE_THEMES, readBridgeTheme } from "../../lib/bridge-theme";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";

export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(readBridgeTheme);
  useEffect(() => {
    document.documentElement.dataset.bridgeTheme = selected;
    try {
      localStorage.setItem("bridge-theme", selected);
    } catch {
      // The palette still works when optional preference storage is unavailable.
    }
  }, [selected]);
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
          <span className="bridge-eyebrow">MAKE YOURSELF AT HOME</span>
          <DialogTitle className="bridge-dialog-title">
            选一种喜欢的颜色。
          </DialogTitle>
          <DialogDescription className="bridge-dialog-description">
            选择后立即生效，下次打开也会记住。所有配色都保留清晰的文字和状态提示。
          </DialogDescription>
          <fieldset className="bridge-theme-options">
            <legend className="sr-only">界面配色</legend>
            {BRIDGE_THEMES.map((theme) => (
              <label
                key={theme.id}
                className={`bridge-theme-option ${selected === theme.id ? "is-selected" : ""}`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="bridge-theme"
                  value={theme.id}
                  checked={selected === theme.id}
                  onChange={() => setSelected(theme.id)}
                />
                <span
                  className="bridge-theme-swatch"
                  style={{ background: theme.paper, color: theme.ink }}
                >
                  <span style={{ background: theme.ink }} />
                  <span style={{ background: theme.ink }} />
                  {selected === theme.id && <Check size={17} />}
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
