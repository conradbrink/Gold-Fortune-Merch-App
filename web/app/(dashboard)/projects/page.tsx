import { Briefcase } from "lucide-react";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function ProjectsPage() {
  return (
    <ComingSoon
      title="Projects"
      description="Group visits and forms into time-boxed initiatives, like a promotion rollout."
      icon={Briefcase}
    />
  );
}
