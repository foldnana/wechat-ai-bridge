import { NavLink, Outlet } from "react-router-dom";
export function WorkspaceLayout() {
  return (
    <div className="flex h-screen flex-col bg-surface-0 text-text-primary">
      <header className="flex flex-wrap items-center gap-6 border-b border-border px-6 py-4">
        <h1 className="font-semibold">微信 AI 接入助手</h1>
        <nav className="flex gap-4 text-sm" aria-label="主导航">
          <NavLink to="/workspace">微信连接</NavLink>
          <NavLink to="/workspace/models?tab=providers">API 与模型</NavLink>
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
