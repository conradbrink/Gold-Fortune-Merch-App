"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { moduleEnabled, type ModuleCode } from "@/lib/modules";
import { useCompanyConfig } from "@/lib/use-company-config";
import type { Tables } from "@/lib/supabase/types";

type Module = Tables<"modules">;

/**
 * What the company's plan includes, read-only.
 *
 * Modules are switched by the platform operator (`/platform`), not here: they
 * are tied to the plan and its price, and self-service changes arrive with
 * billing. Listed from the `modules` catalogue so the names and descriptions
 * are the database's, and modules not built yet are shown as coming rather
 * than hidden — a customer deciding on the product should see where it goes.
 */
export function ModulesCard() {
  const supabase = createClient();
  const company = useCompanyConfig();
  const [modules, setModules] = useState<Module[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("modules")
      .select("*")
      .order("sort_order")
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) setError(e.message);
        else setModules(data);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your plan</CardTitle>
        <CardDescription>
          The modules switched on for your company. To add or remove one, contact
          whoever manages your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {(!modules || !company) && !error && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {modules && company && (
          <ul className="divide-y divide-border">
            {modules.map((m) => {
              const on = moduleEnabled(company.modules, m.code as ModuleCode);
              return (
                <li key={m.code} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.description}</p>
                  </div>
                  {!m.is_built ? (
                    <Badge variant="outline">Coming</Badge>
                  ) : on ? (
                    <Badge className="bg-primary text-primary-foreground">On</Badge>
                  ) : (
                    <Badge variant="secondary">Not in your plan</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
