import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The multi-line partner to `Input`.
 *
 * Added for the HR module, which is the first part of the app to ask anyone to
 * type a paragraph — a disciplinary description, an employee's response to it,
 * a manager's review comments. Every one of those was going into a single-line
 * `Input` before this existed, which is a text box that scrolls sideways while
 * somebody writes the most consequential sentence in the record.
 *
 * The classes are `Input`'s, minus the fixed height and the file-input rules
 * that a textarea cannot have. `field-sizing-content` grows the box with the
 * text where the browser supports it, and `min-h` keeps it usable where it does
 * not.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
