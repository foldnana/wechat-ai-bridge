import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { WorkspaceLayout } from "./layouts/workspace-layout";
import { BridgeSettingsPage } from "./pages/bridge-settings";
import { HomePage } from "./pages/home";
const ModelsPage = lazy(() =>
  import("./pages/models").then((module) => ({ default: module.ModelsPage })),
);
export function App() {
  return (
    <Routes>
      <Route element={<WorkspaceLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/workspace" element={<HomePage />} />
        <Route path="/workspace/home" element={<HomePage />} />
        <Route path="/workspace/channels" element={<HomePage />} />
        <Route path="/workspace/settings" element={<BridgeSettingsPage />} />
        <Route path="/workspace/models" element={<BridgeSettingsPage />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
