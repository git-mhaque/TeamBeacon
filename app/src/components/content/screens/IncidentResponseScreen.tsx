
import { Activity } from "lucide-react";
import { ConstructionScreen } from "./ConstructionScreen";

export function IncidentResponseScreen() {
  return (
    <ConstructionScreen
      description="This operations insights workspace is under construction."
      icon={Activity}
      id="operations-insights-construction"
      title="Operations Insights"
    />
  );
}
