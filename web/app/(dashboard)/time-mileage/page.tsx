import { Clock } from "lucide-react";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function TimeMileagePage() {
  return (
    <ComingSoon
      title="Time & Mileage"
      description="Track working hours and drive distance logged by each rep."
      icon={Clock}
    />
  );
}
