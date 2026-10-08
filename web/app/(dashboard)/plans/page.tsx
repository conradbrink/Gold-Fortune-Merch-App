import { redirect } from "next/navigation";

/** Stage 5's "View plans" page became Billing in Stage 6; old links still work. */
export default function PlansPage() {
  redirect("/billing");
}
