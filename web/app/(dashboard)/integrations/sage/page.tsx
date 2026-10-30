import { redirect } from "next/navigation";

/**
 * The address Sage knows Tickd by (its "logout URL" for Sage ID): the Sage
 * tab in Settings.
 */
export default function SageIntegrationPage() {
  redirect("/settings/sage");
}
