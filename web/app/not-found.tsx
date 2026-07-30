import Link from "next/link";
import { ServiceMessage } from "@/components/service-message";

export default function NotFound() {
  return (
    <ServiceMessage
      title="Page not found"
      detail="That address does not exist. It may have been moved, or the link may be out of date."
    >
      <Link
        href="/"
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Back to the dashboard
      </Link>
    </ServiceMessage>
  );
}
