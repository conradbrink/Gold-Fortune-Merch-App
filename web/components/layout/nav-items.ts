import {
  LayoutDashboard,
  ClipboardList,
  Store,
  Calendar,
  BadgePercent,
  Folder,
  BarChart3,
  Users,
  FileText,
} from "lucide-react";

export const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/activities", label: "Activities", icon: ClipboardList },
  { href: "/stores", label: "Stores", icon: Store },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/promotions", label: "Promotions", icon: BadgePercent },
  { href: "/files", label: "Files", icon: Folder },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/representatives", label: "Representatives", icon: Users },
  { href: "/forms", label: "Forms", icon: FileText },
];
