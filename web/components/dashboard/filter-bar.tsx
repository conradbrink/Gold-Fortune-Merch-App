import { Plus, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

type FilterBarProps = {
  children?: ReactNode;
  onApplyLabel?: string;
};

export function FilterBar({ children, onApplyLabel = "Apply" }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
      {children}
      <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground">
        <Plus className="h-4 w-4" />
        Add filter
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Bookmark className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm">
          Clear
        </Button>
        <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90">
          {onApplyLabel}
        </Button>
      </div>
    </div>
  );
}
