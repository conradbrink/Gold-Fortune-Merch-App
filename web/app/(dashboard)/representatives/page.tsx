import { Users } from "lucide-react";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function RepresentativesPage() {
  return (
    <ComingSoon
      title="Representatives"
      description="Manage your field reps, territories, and mobile app access."
      icon={Users}
    />
  );
}
