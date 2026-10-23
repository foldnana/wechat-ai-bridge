import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";

export function BridgeConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bridge-dialog">
        <span className="bridge-eyebrow">确认操作</span>
        <DialogTitle className="bridge-dialog-title">{title}</DialogTitle>
        <DialogDescription className="bridge-dialog-description">
          {description}
        </DialogDescription>
        <div className="bridge-dialog-actions">
          <button
            type="button"
            className="bridge-button bridge-button-secondary"
            onClick={() => onOpenChange(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="bridge-button"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending && <Loader2 size={16} className="bridge-spin" />}
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
