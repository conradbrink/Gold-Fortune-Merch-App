"use client";

import { useCompanyConfig } from "@/lib/use-company-config";
import { sitesFoundByName } from "@/lib/maps";

/** Whether this company's places are looked up by name as well as address (`sitesFoundByName`). */
export function useSitesByName(): boolean {
  const config = useCompanyConfig();
  return config ? sitesFoundByName(config.modules) : false;
}
