import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { Boot } from "./components/BootSplash";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Nexus could not find the renderer root.");

createRoot(root).render(
  <StrictMode>
    <Boot>
      <App />
    </Boot>
  </StrictMode>,
);
