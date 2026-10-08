import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TryItPanel } from "@/components/team/try-it-panel";

/**
 * "Try it yourself on your phone", the first item on the getting-started list
 * (Stage 7 Part 2c). The owner gets a login of their own for the phone app and
 * sees their first workday on the map before any staff member has one. Behind
 * `admin` in the proxy's permission map, as it makes a login.
 */

export const metadata = { title: "Try it yourself" };

export default function TryItPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Try it yourself</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your phone, in 10 minutes</CardTitle>
          <CardDescription>Do what your team will do, then see it on your map.</CardDescription>
        </CardHeader>
        <CardContent>
          <TryItPanel />
        </CardContent>
      </Card>
    </div>
  );
}
