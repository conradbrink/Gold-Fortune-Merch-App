"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { SidebarContent } from "@/components/layout/sidebar-nav";
import { Button } from "@/components/ui/button";

export function MobileNav({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-sidebar-border bg-sidebar shadow-xl">
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-4 right-3"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </Button>
        <SidebarContent onNavigate={onClose} />
      </aside>
    </div>
  );
}
