import { Navigate, Route, Routes } from "react-router-dom";
import { WorkspaceLayout } from "./layouts/workspace-layout";
import { BridgeSettingsPage } from "./pages/bridge-settings";
import { HomePage } from "./pages/home";
import { ModelsPage } from "./pages/models";
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
        <Route path="/workspace/models/advanced" element={<ModelsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
