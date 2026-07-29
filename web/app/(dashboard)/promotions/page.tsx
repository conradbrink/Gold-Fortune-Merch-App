import { BadgePercent } from "lucide-react";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function PromotionsPage() {
  return (
    <ComingSoon
      title="Promotions"
      description="Deals running at named outlets, confirmed by the rep who is standing there."
      icon={BadgePercent}
    />
  );
}
