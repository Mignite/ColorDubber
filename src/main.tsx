import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { detectLocale } from "./i18n";

detectLocale();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
