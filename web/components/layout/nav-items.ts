import {
  LayoutDashboard,
  ClipboardList,
  Store,
  Calendar,
  Briefcase,
  Folder,
  BarChart3,
  Users,
  Clock,
  FileText,
} from "lucide-react";

export const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/activities", label: "Activities", icon: ClipboardList },
  { href: "/stores", label: "Stores", icon: Store },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/projects", label: "Projects", icon: Briefcase },
  { href: "/files", label: "Files", icon: Folder },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/representatives", label: "Representatives", icon: Users },
  { href: "/time-mileage", label: "Time & Mileage", icon: Clock },
  { href: "/forms", label: "Forms", icon: FileText },
];
