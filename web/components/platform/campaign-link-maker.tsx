"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { campaignSlug } from "@/lib/acquisition";

/**
 * Makes the link for an advert or post, so it shows up on the Campaigns tab
 * by itself: nothing is created in Tickd; the campaign is in the link. For
 * Facebook and Instagram ads it gives the two Ads Manager boxes instead, so
 * every ad fills in its own campaign name ({{campaign.name}}) and whether the
 * click came from Facebook or Instagram ({{site_source_name}}).
 */

const PLACES = {
  meta_ad: { label: "Facebook or Instagram ad (Ads Manager)", source: "", medium: "paid_social" },
  facebook_post: { label: "Facebook page post", source: "facebook", medium: "social" },
  instagram: { label: "Instagram bio, post or story", source: "instagram", medium: "social" },
  whatsapp: { label: "WhatsApp message or status", source: "whatsapp", medium: "social" },
  google_ad: { label: "Google ad", source: "google", medium: "cpc" },
  email: { label: "Email", source: "newsletter", medium: "email" },
  print: { label: "Flyer, poster or QR code", source: "print", medium: "offline" },
} as const;

type Place = keyof typeof PLACES;

const PAGES = { "/founding": "The Founding offer page", "/": "The home page" } as const;


export function CampaignLinkMaker() {
  const [place, setPlace] = useState<Place>("meta_ad");
  const [page, setPage] = useState<keyof typeof PAGES>("/founding");
  const [name, setName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const slug = campaignSlug(name);
  const base = `https://tickd.co.za${page}`;
  const p = PLACES[place];

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  const metaParams = "utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}";
  const link = slug ? `${base}?utm_source=${p.source}&utm_medium=${p.medium}&utm_campaign=${slug}` : "";

  const output = (what: string, label: string, text: string) => (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-xs text-foreground">{text}</code>
        <Button type="button" variant="outline" size="sm" onClick={() => copy(what, text)}>
          {copied === what ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Make a campaign link</h2>
        <p className="text-sm text-muted-foreground">
          A campaign appears below as soon as someone clicks a link that carries its name. There&apos;s nothing to create
          here: make the link, use it in the advert or post, and the numbers follow.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72 space-y-1">
          <label htmlFor="place" className="text-sm text-muted-foreground">
            Where it will be used
          </label>
          <NativeSelect id="place" value={place} onChange={(e) => setPlace(e.target.value as Place)}>
            {Object.entries(PLACES).map(([key, v]) => (
              <option key={key} value={key}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-56 space-y-1">
          <label htmlFor="page" className="text-sm text-muted-foreground">
            Page it opens
          </label>
          <NativeSelect id="page" value={page} onChange={(e) => setPage(e.target.value as keyof typeof PAGES)}>
            {Object.entries(PAGES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {place !== "meta_ad" && (
          <div className="min-w-56 flex-1 space-y-1">
            <label htmlFor="campaign" className="text-sm text-muted-foreground">
              Campaign name
            </label>
            <Input id="campaign" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Founding October cleaners" />
          </div>
        )}
      </div>

      {place === "meta_ad" ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            In Ads Manager, at the <strong>Ad</strong> step, under Destination: put the first line in{" "}
            <strong>Website URL</strong> and the second in <strong>URL parameters</strong>. Facebook fills in each
            campaign&apos;s name and whether the click came from Facebook or Instagram, so name your campaigns plainly.
          </p>
          {output("url", "Website URL", base)}
          {output("params", "URL parameters", metaParams)}
        </div>
      ) : slug ? (
        output("link", "The link to use", link)
      ) : (
        <p className="text-sm text-muted-foreground">Type a campaign name to get the link.</p>
      )}
    </section>
  );
}
