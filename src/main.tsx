// EasyWork - React 渲染入口
// 将 App 组件挂载到 index.html 的 <div id="root"> 上。

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// 控制台提示
console.log("EasyWork v1.0");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
