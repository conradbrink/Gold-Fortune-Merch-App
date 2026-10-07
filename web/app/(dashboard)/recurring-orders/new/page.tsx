"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecurringForm } from "@/components/recurring/recurring-form";

export default function NewRecurringOrderPage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/recurring-orders" className="text-sm text-muted-foreground hover:text-foreground">
          ← Recurring orders
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">New recurring order</h1>
        <p className="text-sm text-muted-foreground">
          Placed automatically as a new order on each date. The warehouse confirms it like any other.
        </p>
      </div>
      <RecurringForm
        onSaved={(id) => router.push(`/recurring-orders/${id}`)}
        onCancel={() => router.push("/recurring-orders")}
      />
    </div>
  );
}
