"use client";

import { useState } from "react";
import { MapPin, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { googleMapsUrl, googleMapsEmbedUrl } from "@/lib/maps";

export type MapPlace = {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export function PlacesMap({ places }: { places: MapPlace[] }) {
  const [selectedId, setSelectedId] = useState<string | undefined>(places[0]?.id);
  const selected = places.find((p) => p.id === selectedId) ?? places[0];

  if (!selected) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        No stores to show on the map.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      <div className="max-h-[280px] overflow-y-auto rounded-lg border border-border bg-card lg:max-h-[560px]">
        {places.map((place) => (
          <button
            key={place.id}
            onClick={() => setSelectedId(place.id)}
            className={cn(
              "flex w-full items-start gap-3 border-b border-border p-3 text-left last:border-b-0 hover:bg-accent/50",
              selected.id === place.id && "bg-accent/70"
            )}
          >
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <MapPin className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {place.name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {[place.address, place.city, place.state].filter(Boolean).join(", ")}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <div className="overflow-hidden rounded-lg border border-border">
          <iframe
            key={selected.id}
            title={`Map for ${selected.name}`}
            src={googleMapsEmbedUrl(selected)}
            className="h-[360px] w-full lg:h-[520px]"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
        <a
          href={googleMapsUrl(selected)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open {selected.name} in Google Maps
        </a>
      </div>
    </div>
  );
}
