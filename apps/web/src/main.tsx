import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./app";
import { LocaleProvider } from "./hooks/use-locale";
import "./i18n";
import "./index.css";
import "./bridge.css";
import "./bridge-themes.css";
import { readBridgeTheme } from "./lib/bridge-theme";
import "./lib/api";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});
const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
document.title = "Bridge · 微信 AI 接入助手";
document.documentElement.dataset.bridgeTheme = readBridgeTheme();
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster position="top-right" />
        </BrowserRouter>
      </QueryClientProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
