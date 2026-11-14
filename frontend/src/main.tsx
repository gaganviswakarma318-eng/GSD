import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/base.css";
import "./styles/workspace.css";
import "./features/instagram-downloader/instagram.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
