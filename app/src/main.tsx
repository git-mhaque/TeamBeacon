import { createRoot } from "react-dom/client";

import { App } from "./components/app";
import "./styles/app.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("TeamBeacon root element was not found.");
}

createRoot(rootElement).render(<App appName="TeamBeacon" />);
