import { createRoot } from "react-dom/client";
import { DashboardApp } from "./DashboardApp";
import { createDashboardBridge } from "./bridge";

createRoot(document.getElementById("root")!).render(<DashboardApp bridge={createDashboardBridge()} />);
