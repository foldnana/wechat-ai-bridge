import {
  ArrowUpRight,
  AudioLines,
  CircleHelp,
  Command,
  Laptop,
  Link2,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BridgeMark } from "../components/bridge/bridge-mark";
import { ThemePicker } from "../components/bridge/theme-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";

export function WorkspaceLayout() {
  const location = useLocation();
  const isSettings = /\/(models|settings)/.test(location.pathname);
  const [helpOpen, setHelpOpen] = useState(false);
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
    <div className="bridge-app">
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
        <div className="bridge-nav-label">你的工作空间</div>
        <nav className="bridge-nav" aria-label="主导航">
          <Link
            to="/workspace"
            aria-label="微信连接"
            className={`bridge-nav-link ${!isSettings ? "is-active" : ""}`}
            aria-current={!isSettings ? "page" : undefined}
          >
            <Link2 size={19} />
            <span>微信连接</span>
            <ArrowUpRight size={15} className="bridge-nav-arrow" />
          </Link>
          <Link
            to="/workspace/models"
            aria-label="API 与模型"
            aria-current={isSettings ? "page" : undefined}
            className={`bridge-nav-link ${isSettings ? "is-active" : ""}`}
          >
            <SlidersHorizontal size={19} />
            <span>API 与模型</span>
            <ArrowUpRight size={15} className="bridge-nav-arrow" />
          </Link>
        </nav>
        <div className="bridge-sidebar-bottom">
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
            <span className="bridge-local-caption">MADE FOR YOUR EVERYDAY</span>
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
            <strong>{isSettings ? "API 与模型" : "微信连接"}</strong>
          </div>
          <div className="bridge-topbar-actions">
            <ThemePicker />
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
        <main id="bridge-main" className="bridge-main" tabIndex={-1}>
          <div className="bridge-page-transition" key={location.pathname}>
            <Outlet />
          </div>
        </main>
      </div>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="bridge-dialog">
          <span className="bridge-eyebrow">A LITTLE HELP</span>
          <DialogTitle className="bridge-dialog-title">
            很快，就能聊起来。
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
                <p>前往「API 与模型」，填写服务商提供的密钥，测试并保存。</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>连接你的微信</strong>
                <p>回到「微信连接」，获取二维码，在微信中扫码并确认授权。</p>
              </div>
            </li>
          </ol>
          <p className="bridge-note">
            <Laptop size={16} />
            使用时电脑需要保持开机、联网且不休眠。目前支持个人微信 ClawBot。
          </p>
          <button
            type="button"
            className="bridge-button"
            onClick={() => setHelpOpen(false)}
          >
            知道了
            <ArrowUpRight size={16} />
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
