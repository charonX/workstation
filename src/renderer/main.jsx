import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "../../.aiassist/global/tokens.css";
import "./index.css";

// 同步路径到 hash 路由（兼容浏览器直访与测试导航）
if (
  typeof window !== "undefined" &&
  window.location.pathname &&
  window.location.pathname !== "/" &&
  (!window.location.hash || window.location.hash === "#/")
) {
  window.location.hash = `#${window.location.pathname}`;
}

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
