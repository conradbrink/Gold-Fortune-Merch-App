import type { LucideIcon } from "lucide-react";
import type { Tables } from "@/lib/supabase/types";
import type { Setup, StepText } from "@/lib/setup";

export type Org = Tables<"organizations">;

/** What every step is handed by the wizard page. */
export type StepProps = {
  org: Org;
  setup: Setup;
  text: StepText;
  icon: LucideIcon;
  /** The signed-in owner's own email, to offer as the company's. */
  ownerEmail: string;
  onBack?: () => void;
  /** Moves on; the page remembers where the wizard is. */
  onNext: () => void;
  /** Reads the company and the wizard's counts again after a step saved. */
  reload: () => Promise<void>;
  /** Marks the wizard finished, then opens the page. */
  onFinish: (href: string) => void;
};
