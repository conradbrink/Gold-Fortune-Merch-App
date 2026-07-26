import type { LucideIcon } from "lucide-react";

export function ComingSoon({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card py-24 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Icon className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium text-foreground">Coming soon</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          This module isn&apos;t part of the MVP build yet. It&apos;s tracked
          in the project roadmap.
        </p>
      </div>
    </div>
  );
}
