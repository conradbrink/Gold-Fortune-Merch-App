"use client";

import { useParams } from "next/navigation";
import { QuoteForm } from "@/components/money/quote-form";

export default function EditQuotePage() {
  const { id } = useParams<{ id: string }>();
  return <QuoteForm quoteId={id} />;
}
