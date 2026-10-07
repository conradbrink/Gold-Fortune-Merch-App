import Image from "next/image";
import { PRODUCT_MARK, PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/product";

/**
 * The product's mark and name, for the pages shown before anyone has signed
 * in: login, the password pages, the download page and the error pages.
 *
 * Never a company's logo. Nobody is signed in yet, so there is no company to
 * know about, and showing one company's logo to everybody who opens the login
 * page would put it in front of every other company's staff.
 *
 * Plain markup and next/image only, like `ServiceMessage`, which renders it
 * from the global error boundary where the root layout has already failed.
 */
export function ProductBrand({
  size = 56,
  subtitle = PRODUCT_TAGLINE,
  priority = false,
}: {
  size?: number;
  /** The line under the name; the tagline unless a page has a better one. */
  subtitle?: string;
  priority?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Image
        src={PRODUCT_MARK}
        alt=""
        width={size}
        height={size}
        className={size > 56 ? "rounded-xl" : "rounded-lg"}
        priority={priority}
      />
      <div>
        <h1 className="text-xl font-bold text-foreground">{PRODUCT_NAME}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
