import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { loadAppConfig } from "./app-config.js";
import "./styles.css";

// The server owns the network identity. Resolve it before the first render so
// address prefixes and the wallet network are correct from the start.
void loadAppConfig().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
