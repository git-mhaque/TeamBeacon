
import { ShieldCheck } from "lucide-react";
import { ConstructionScreen } from "./ConstructionScreen";

export function SecurityScreen() {
  return (
    <ConstructionScreen
      description="This security insights workspace is under construction."
      icon={ShieldCheck}
      id="security-insights-construction"
      title="Security Insights"
    />
  );
}
