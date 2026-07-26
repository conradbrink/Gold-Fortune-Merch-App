import { ClipboardList } from "lucide-react";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function ActivitiesPage() {
  return (
    <ComingSoon
      title="Activities"
      description="A live feed of field activity across all reps and places."
      icon={ClipboardList}
    />
  );
}
