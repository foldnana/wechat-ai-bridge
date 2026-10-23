import {
  ArrowRight,
  KeyRound,
  Laptop,
  QrCode,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { WhaleCompanion } from "./whale-companion";
import "./welcome-guide.css";

const STORAGE_KEY = "bridge-welcome-seen";

export function shouldShowWelcomeGuide() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "yes";
  } catch {
    return true;
  }
}

export function rememberWelcomeGuide() {
  try {
    localStorage.setItem(STORAGE_KEY, "yes");
  } catch {
    // The guide must remain dismissible even when local storage is unavailable.
  }
}

const STEPS = [
  {
    label: "配置 API",
    title: "先把模型接上",
    description:
      "在「模型连接」里，填入你自己的 API Key，选择模型，再点击测试并保存。",
    icon: KeyRound,
    actions: ["选择 API 服务商", "粘贴密钥，读取并选择模型", "测试并保存模型"],
    note: "API Key 是模型服务商提供的密钥，不是微信密码。调用费用由服务商收取。",
  },
  {
    label: "连接微信",
    title: "拿起手机，扫码连接",
    description:
      "模型保存后，打开「微信连接」，获取二维码，用手机微信扫码并确认授权。",
    icon: QrCode,
    actions: [
      "打开「微信连接」",
      "获取二维码并扫码授权",
      "连接成功后，去微信里聊天",
    ],
    note: "使用个人微信 ClawBot 通道。电脑要开机、联网且不休眠，程序保持运行才能回复。",
  },
  {
    label: "日常使用",
    title: "先聊起来，其他慢慢调",
    description: "默认就是大肥鱼人设。连上后就能聊天，不必先研究所有设置。",
    icon: SlidersHorizontal,
    actions: [
      "「回答风格」：修改人设和说话方式",
      "「聊天行为」：设置接话节奏、表情等",
      "「对话管理」：查看会话或新开对话",
    ],
    note: "收不到回复时，先看「运行记录」，或点击顶部「诊断」。这份指引可在「使用说明」里重新打开。",
  },
] as const;

export function WelcomeGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const current = STEPS[step] ?? STEPS[0];
  const last = step === STEPS.length - 1;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="bridge-dialog bridge-guide">
        <div className="bridge-guide-heading">
          <span className="bridge-eyebrow">
            新手指引 · {step + 1} / {STEPS.length}
          </span>
          <button type="button" className="bridge-guide-skip" onClick={onClose}>
            跳过指引
          </button>
        </div>
        <ol className="bridge-guide-progress" aria-label="指引步骤">
          {STEPS.map((item, index) => (
            <li
              key={item.label}
              aria-current={index === step ? "step" : undefined}
            >
              <span>{index + 1}</span>
              {item.label}
            </li>
          ))}
        </ol>
        <div
          className="bridge-guide-body"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="bridge-guide-intro">
            <div>
              <DialogTitle className="bridge-dialog-title">
                {current.title}
              </DialogTitle>
              <DialogDescription className="bridge-dialog-description">
                {current.description}
              </DialogDescription>
            </div>
            <div className="bridge-guide-whale">
              <WhaleCompanion />
            </div>
          </div>
          <div className="bridge-guide-card">
            <current.icon size={26} aria-hidden="true" />
            <ol>
              {current.actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ol>
          </div>
          <p className="bridge-guide-note">
            <Laptop size={16} aria-hidden="true" />
            {current.note}
          </p>
        </div>
        <div className="bridge-guide-footer">
          <button
            type="button"
            className="bridge-button bridge-button-secondary"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            上一步
          </button>
          <button
            type="button"
            className="bridge-button"
            onClick={() => {
              if (last) {
                onClose();
                navigate("/workspace/models");
              } else setStep(step + 1);
            }}
          >
            {last ? "开始配置 API" : "下一步"}
            <ArrowRight size={16} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
