import { Download, ChevronDown, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { LegendDonut } from "@/components/dashboard/legend-donut";
import {
  facingsByLocation,
  shelfFacingStats,
  couponAvailability,
} from "@/lib/mock-data";

export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Merchandising Conditions Audit
          </h1>
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </div>
        <Button className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground">
          11/01/2026 – 11/30/2026
        </div>
        <Button variant="outline" size="sm">
          + Add filter
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm">
            Clear
          </Button>
          <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90">
            Apply
          </Button>
        </div>
      </div>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  How many facings are there at this location?
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex gap-6 text-sm">
                  <span>
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-chart-1" />
                    Min <span className="font-semibold">{shelfFacingStats.min}</span>
                  </span>
                  <span>
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-chart-3" />
                    Avg <span className="font-semibold">{shelfFacingStats.avg}</span>
                  </span>
                  <span>
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-primary" />
                    Max <span className="font-semibold">{shelfFacingStats.max}</span>
                  </span>
                  <span>
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-gold" />
                    Sum <span className="font-semibold">{shelfFacingStats.sum}</span>
                  </span>
                </div>
                <HorizontalBarChart
                  data={[
                    { label: "Facings", Min: shelfFacingStats.min, Avg: shelfFacingStats.avg, Max: shelfFacingStats.max, Sum: shelfFacingStats.sum },
                  ]}
                  categoryKey="label"
                  dataKey="Sum"
                  color="var(--color-gold)"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Where is the product located on the shelf?
                </CardTitle>
              </CardHeader>
              <CardContent>
                <HorizontalBarChart
                  data={facingsByLocation}
                  categoryKey="location"
                  dataKey="value"
                  color="var(--color-primary)"
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Are there any coupons available?
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LegendDonut data={couponAvailability} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Take photo of shelf before restocking
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex aspect-square items-center justify-center rounded-md bg-secondary text-muted-foreground"
                    >
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="submissions" className="mt-4">
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Individual submission records will appear here once the Forms
              module is wired to live data.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
