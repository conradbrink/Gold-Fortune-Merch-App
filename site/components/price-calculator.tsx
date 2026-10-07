"use client";

import { useId, useState } from "react";
import { monthlyPrice, pricing, rand } from "@/lib/site";

export function PriceCalculator() {
  const [users, setUsers] = useState(3);
  const id = useId();
  const isBusiness = users >= pricing.businessPlanFrom;
  const extra = Math.max(0, users - pricing.includedUsers);

  return (
    <div className="rounded-3xl bg-teal-900 p-6 text-sand sm:p-8">
      <label htmlFor={id} className="flex items-baseline justify-between gap-4">
        <span className="font-semibold">How many people on your team?</span>
        <span className="font-display text-3xl font-extrabold text-amber-500">
          {isBusiness ? `${pricing.businessPlanFrom}+` : users}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={1}
        max={pricing.businessPlanFrom}
        value={users}
        onChange={(e) => setUsers(Number(e.target.value))}
        className="mt-4 w-full accent-amber-500"
      />
      <div className="mt-6 border-t border-white/15 pt-5">
        {isBusiness ? (
          <>
            <p className="font-display text-2xl font-bold">Business plan</p>
            <p className="mt-1 text-sm text-teal-100">
              Teams of {pricing.businessPlanFrom} or more get a quoted price. Talk to us.
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-4xl font-extrabold">
              {rand(monthlyPrice(users))}
              <span className="text-base font-medium text-teal-100"> / month</span>
            </p>
            <p className="mt-1 text-sm text-teal-100">
              {rand(pricing.base)} for the first {pricing.includedUsers} users
              {extra > 0 && ` + ${extra} × ${rand(pricing.perExtraUser)}`}. Includes VAT.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
