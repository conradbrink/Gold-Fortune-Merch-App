import { Folder } from "lucide-react";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function FilesPage() {
  return (
    <ComingSoon
      title="Files"
      description="Shared documents, planograms, and reference materials for the team."
      icon={Folder}
    />
  );
}
