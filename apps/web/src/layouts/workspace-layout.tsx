import {
  Activity,
  ArrowUpRight,
  AudioLines,
  CircleHelp,
  Command,
  Laptop,
  LayoutGrid,
  Link2,
  MessagesSquare,
  Settings2,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BridgeMark } from "../components/bridge/bridge-mark";
import { DiagnosticsButton } from "../components/bridge/diagnostics-button";
import { ThemePicker } from "../components/bridge/theme-picker";
import {
  WelcomeGuide,
  rememberWelcomeGuide,
  shouldShowWelcomeGuide,
} from "../components/bridge/welcome-guide";
import { WhaleCompanion } from "../components/bridge/whale-companion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";

const NAVIGATION = [
  { path: "/workspace", label: "总览", icon: LayoutGrid, group: "工作空间" },
  {
    path: "/workspace/models",
    label: "模型连接",
    icon: SlidersHorizontal,
    group: "连接设置",
  },
  { path: "/workspace/wechat", label: "微信连接", icon: Link2 },
  {
    path: "/workspace/preset",
    label: "回答风格",
    icon: Sparkles,
    group: "日常使用",
  },
  { path: "/workspace/sessions", label: "对话管理", icon: MessagesSquare },
  { path: "/workspace/behavior", label: "聊天行为", icon: Settings2 },
  { path: "/workspace/activity", label: "运行记录", icon: Activity },
];

export function WorkspaceLayout() {
  const location = useLocation();
  const currentPage =
    NAVIGATION.find(
      (item) =>
        item.path !== "/workspace" && location.pathname.startsWith(item.path),
    ) ?? NAVIGATION[0];
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    main.current?.scrollTo({ top: 0, behavior: "instant" });
    main.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(shouldShowWelcomeGuide);
  const closeGuide = () => {
    rememberWelcomeGuide();
    setGuideOpen(false);
  };
  const [motion, setMotion] = useState(() => {
    try {
      return localStorage.getItem("bridge-motion") !== "off";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.bridgeMotion = motion ? "on" : "off";
    try {
      localStorage.setItem("bridge-motion", motion ? "on" : "off");
    } catch {
      /* Visual preferences are optional when storage is unavailable. */
    }
  }, [motion]);

  return (
    <div className="bridge-app bridge-app-pages">
      <a className="bridge-skip-link" href="#bridge-main">
        跳转到主要内容
      </a>
      <aside className="bridge-sidebar">
        <NavLink
          className="bridge-brand"
          to="/workspace"
          aria-label="微信 AI 接入助手首页"
        >
          <span className="bridge-brand-symbol">
            <BridgeMark />
          </span>
          <span className="bridge-brand-type">
            Bridge<span>微信 AI 接入助手</span>
          </span>
        </NavLink>
        <nav className="bridge-nav" aria-label="主导航">
          {NAVIGATION.map((item) => (
            <div key={item.path} className="bridge-nav-item">
              {item.group && (
                <div className="bridge-nav-label">{item.group}</div>
              )}
              <NavLink
                to={item.path}
                end={item.path === "/workspace"}
                className={({ isActive }) =>
                  `bridge-nav-link ${isActive ? "is-active" : ""}`
                }
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                <ArrowUpRight size={14} className="bridge-nav-arrow" />
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="bridge-sidebar-bottom">
          <div className="bridge-whale-note">
            <WhaleCompanion />
            <div>
              <strong>大肥鱼</strong>
              <span>有事说事，没事唠两句。</span>
            </div>
          </div>
          <div className="bridge-local-note">
            <span className="bridge-small-symbol">
              <Laptop size={18} />
            </span>
            <strong>你的电脑，你的 AI。</strong>
            <p>
              使用自己的 API，
              <br />
              让连接在本机轻松完成。
            </p>
            <span className="bridge-local-caption">本机运行 · API 自备</span>
          </div>
          <button
            type="button"
            className="bridge-help-button"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={17} />
            使用说明
            <ArrowUpRight size={14} />
          </button>
          <div className="bridge-sidebar-footer">
            <span className="bridge-tiny-mark" />
            WECHAT AI BRIDGE
          </div>
        </div>
      </aside>
      <div className="bridge-workspace">
        <header className="bridge-topbar">
          <div className="bridge-breadcrumb">
            <Command size={15} />
            <span>工作空间</span>
            <span className="bridge-breadcrumb-divider">/</span>
            <strong>{currentPage?.label ?? "总览"}</strong>
          </div>
          <div className="bridge-topbar-actions">
            <ThemePicker />
            <DiagnosticsButton />
            <button
              type="button"
              className="bridge-motion-toggle bridge-mobile-help"
              aria-label="使用说明"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={17} />
            </button>
            <span className="bridge-platform-label">
              <Laptop size={14} />
              本机运行
            </span>
            <button
              type="button"
              className={`bridge-motion-toggle ${motion ? "is-active" : ""}`}
              aria-label={motion ? "关闭动态效果" : "开启动态效果"}
              aria-pressed={motion}
              title={motion ? "关闭动态效果" : "开启动态效果"}
              onClick={() => setMotion(!motion)}
            >
              <AudioLines size={17} />
            </button>
          </div>
        </header>
        <main ref={main} id="bridge-main" className="bridge-main" tabIndex={-1}>
          <div className="bridge-page-transition" key={location.pathname}>
            <Outlet />
          </div>
        </main>
      </div>
      {guideOpen && <WelcomeGuide onClose={closeGuide} />}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="bridge-dialog">
          <span className="bridge-eyebrow">使用说明</span>
          <DialogTitle className="bridge-dialog-title">
            两步完成接入
          </DialogTitle>
          <DialogDescription className="bridge-dialog-description">
            Bridge 在你的电脑上连接模型与微信。准备自己的 API
            Key，按下面两步操作即可。
          </DialogDescription>
          <ol className="bridge-help-steps">
            <li>
              <span>01</span>
              <div>
                <strong>添加你的模型</strong>
                <p>前往「模型连接」，填写服务商提供的密钥，测试并保存。</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>连接你的微信</strong>
                <p>前往「微信连接」，获取二维码，在微信中扫码并确认授权。</p>
              </div>
            </li>
          </ol>
          <p className="bridge-note">
            <Laptop size={16} />
            使用时电脑需要保持开机、联网且不休眠。目前支持个人微信 ClawBot。
          </p>
          <button
            type="button"
            className="bridge-button bridge-button-secondary"
            onClick={() => {
              setHelpOpen(false);
              setGuideOpen(true);
            }}
          >
            重新查看新手指引
          </button>
          <button
            type="button"
            className="bridge-button"
            onClick={() => setHelpOpen(false)}
          >
            知道了
            <ArrowUpRight size={16} />
          </button>
          <p className="bridge-art-credit">
            鲸鱼娘素材：
            <a
              href="https://github.com/YunYueSama/codex-deepseek-pet"
              target="_blank"
              rel="noreferrer"
            >
              YunYueSama / codex-deepseek-pet
            </a>
            。 原图未修改，界面以 CSS 播放眨眼与漂浮。
            <a
              href="/licenses/codex-deepseek-pet/LICENSE.txt"
              target="_blank"
              rel="noreferrer"
            >
              完整许可
            </a>{" "}
            ·{" "}
            <a
              href="/licenses/codex-deepseek-pet/ASSET_LICENSE.txt"
              target="_blank"
              rel="noreferrer"
            >
              素材来源与权利说明
            </a>
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
