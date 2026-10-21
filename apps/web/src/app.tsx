import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { WorkspaceLayout } from "./layouts/workspace-layout";
import { ActivityPage } from "./pages/activity";
import { BehaviorPage } from "./pages/behavior";
import { BridgeSettingsPage } from "./pages/bridge-settings";
import { HomePage } from "./pages/home";
import { WechatPage } from "./pages/wechat";
const ModelsPage = lazy(() =>
  import("./pages/models").then((module) => ({ default: module.ModelsPage })),
);
export function App() {
  return (
    <Routes>
      <Route element={<WorkspaceLayout />}>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route path="/workspace" element={<HomePage />} />
        <Route
          path="/workspace/home"
          element={<Navigate to="/workspace" replace />}
        />
        <Route
          path="/workspace/channels"
          element={<Navigate to="/workspace/wechat" replace />}
        />
        <Route path="/workspace/wechat" element={<WechatPage />} />
        <Route
          path="/workspace/settings"
          element={<Navigate to="/workspace/models" replace />}
        />
        <Route
          path="/workspace/models"
          element={<BridgeSettingsPage key="model" section="model" />}
        />
        <Route
          path="/workspace/preset"
          element={<BridgeSettingsPage key="preset" section="preset" />}
        />
        <Route
          path="/workspace/sessions"
          element={<BridgeSettingsPage key="sessions" section="sessions" />}
        />
        <Route path="/workspace/activity" element={<ActivityPage />} />
        <Route path="/workspace/behavior" element={<BehaviorPage />} />
        <Route
          path="/workspace/models/advanced"
          element={
            <Suspense
              fallback={
                <div className="bridge-loading">正在打开供应商管理…</div>
              }
            >
              <div className="bridge-legacy">
                <ModelsPage />
              </div>
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/workspace" replace />} />
    </Routes>
  );
}
