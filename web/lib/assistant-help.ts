import { lower, withArticle, type Terms } from "@/lib/terms";

/**
 * How to do things by hand, for the AI Manager's `how_to` lookup.
 *
 * When somebody asks how to do something the assistant cannot do for them, it
 * reads one of these and repeats it, with a link to the page the steps start
 * on. It never writes steps of its own, so every step here was written from
 * the page itself: the button, tab, dialog and menu labels are the ones the
 * code renders, in the company's own words (`lib/terms.ts`). A label that
 * changes on a page has to change here too, or the assistant sends somebody
 * looking for a button that is not there.
 *
 * Who may have the steps follows `page`, the same rule as the menu: somebody
 * who cannot open the page is not given them. So the steps never say who is
 * allowed; the page decides.
 *
 * Settings the customer does not set (Tickd sets them from the Control
 * Centre) have no steps here.
 */

export type HelpTopic = {
  /** Stable id the AI passes back, kebab-case: "add-store". */
  id: string;
  /** What the person wants to do, in their words: "Add a store". */
  title: (t: Terms) => string;
  /** The page the steps start on. Access follows it: someone who can't open it isn't given the steps. */
  page: string;
  /** 2 to 6 short steps, in order. Button and tab names exactly as on screen, in quotes. */
  steps: (t: Terms) => string[];
};

export const HELP_TOPICS: readonly HelpTopic[] = [
  /* ---------------------------------------------------------------- stores */
  {
    id: "add-store",
    title: (t) => `Add ${withArticle(t, "site")}`,
    page: "/stores",
    steps: (t) => [
      `Open "${t.site.many}" in the menu.`,
      `Press "New ${lower(t.site.one)}".`,
      `Fill in the "${t.site.one} name", "Address" and "City".`,
      `Choose its "${t.site_group.one}", and how often it is visited under "${t.schedule_cycle.one}".`,
      `Press "Create ${lower(t.site.one)}".`,
    ],
  },
  {
    id: "edit-store",
    title: (t) => `Change ${withArticle(t, "site")}'s details`,
    page: "/stores",
    steps: (t) => [
      `Open "${t.site.many}" in the menu.`,
      `Press the three dots at the end of the ${lower(t.site.one)}'s row and choose "Edit ${lower(t.site.one)}".`,
      `Change the name, address, ${lower(t.site_group.one)} or anything else that is wrong.`,
      `Press "Save changes".`,
    ],
  },
  {
    id: "fix-store-location",
    title: (t) => `Fix ${withArticle(t, "site")}'s location on the map`,
    page: "/stores/review",
    steps: (t) => [
      `Open "${t.site.many}" in the menu, then the "Location exceptions" tab.`,
      `Look at the ${lower(t.site.one)} it shows. Press "Skip for now" to go to the next one.`,
      `Click the map, or drag the pin, to where the ${lower(t.site.one)} really is.`,
      `Press "Save this position". If the pin was right all along, press "This is correct" instead.`,
    ],
  },
  {
    id: "deactivate-store",
    title: (t) => `Turn off ${withArticle(t, "site")}`,
    page: "/stores",
    steps: (t) => [
      `Open "${t.site.many}" in the menu.`,
      `Press the three dots at the end of the ${lower(t.site.one)}'s row.`,
      `Choose "Deactivate". Its ${lower(t.job.one)} history is kept.`,
      `Choose "Reactivate" in the same place to bring it back.`,
    ],
  },
  {
    id: "import-stores",
    title: (t) => `Import ${lower(t.site.many)} from a spreadsheet`,
    page: "/stores",
    steps: (t) => [
      `Open "${t.site.many}" in the menu and press "Import".`,
      `Press "Choose a spreadsheet" and pick your Excel or CSV file.`,
      `Check that each column is matched, like "${t.site.one} name", "Address" and "City".`,
      `Look over the rows, then press the button at the bottom that says how many ${lower(t.site.many)} it will import.`,
      `Press "Close" when it is done.`,
    ],
  },
  {
    id: "group-stores",
    title: (t) => `Put ${lower(t.site.many)} in ${withArticle(t, "site_group")}`,
    page: "/stores",
    steps: (t) => [
      `Open "${t.site.many}" in the menu and press "Groups".`,
      `Type the new ${lower(t.site_group.one)}'s name at the top and press "Add", then close the box.`,
      `Press the three dots at the end of a ${lower(t.site.one)}'s row and choose "Edit ${lower(t.site.one)}".`,
      `Choose the ${lower(t.site_group.one)} under "${t.site_group.one}" and press "Save changes".`,
    ],
  },
  {
    id: "store-contacts",
    title: (t) => `Add a contact for ${withArticle(t, "site")}`,
    page: "/stores",
    steps: (t) => [
      `Open "${t.site.many}" in the menu.`,
      `Press the three dots at the end of the ${lower(t.site.one)}'s row and choose "Contacts".`,
      `Press "Add a contact" and fill in their "Name" and "Email".`,
      `Tick "Gets invoices and statements" if invoices should go to them, and "Send them each finished ${lower(t.job.one)}'s report" if they should get the reports.`,
      `Press "Save contact".`,
    ],
  },
  {
    id: "visit-frequency",
    title: (t) => `Set how often ${withArticle(t, "site")} is visited`,
    page: "/stores",
    steps: (t) => [
      `Open "${t.site.many}" in the menu.`,
      `Press the three dots at the end of the ${lower(t.site.one)}'s row and choose "Edit ${lower(t.site.one)}".`,
      `Under "${t.schedule_cycle.one}", choose "Weekly", "Every 2 weeks" or "Monthly".`,
      `Press "Save changes". It applies to every ${lower(t.staff.one)} who covers the ${lower(t.site.one)}.`,
      `Give it a day on the "${t.schedule_cycle.one}" tab of "Schedule" so it gets planned.`,
    ],
  },

  /* ------------------------------------------------------- reps and coverage */
  {
    id: "assign-stores",
    title: (t) => `Assign ${lower(t.site.many)} to ${withArticle(t, "staff")}`,
    page: "/representatives",
    steps: (t) => [
      `Open "${t.staff.many}" in the menu.`,
      `Press "Manage" next to the ${lower(t.staff.one)}.`,
      `Press a ${lower(t.site_group.one)}'s name to open it, then tick each ${lower(t.site.one)} this ${lower(t.staff.one)} should cover. Each tick saves straight away.`,
      `Untick a ${lower(t.site.one)} to take it off them.`,
    ],
  },
  {
    id: "change-many-stores",
    title: (t) => `Assign or change many ${lower(t.site.many)} at once`,
    page: "/representatives",
    steps: (t) => [
      `Open "${t.staff.many}" in the menu and go down to "Coverage".`,
      `Narrow the list with the search and filters, then tick the ${lower(t.site.many)} you want, or press "Select all".`,
      `Under "Action", choose "Assign to ${lower(t.staff.one)}", "Remove ${lower(t.staff.one)}", "Set frequency", "Set day" or "Move to ${lower(t.territory.one)}".`,
      `Choose the ${lower(t.staff.one)}, frequency, day or ${lower(t.territory.one)} next to it.`,
      `Press the "Apply to" button.`,
    ],
  },
  {
    id: "add-territory",
    title: (t) => `Add ${withArticle(t, "territory")}`,
    page: "/territories",
    steps: (t) => [
      `Open "${t.territory.many}" in the menu.`,
      `Find the ${lower(t.region.one)} it belongs in and press "${t.territory.one}" with the plus on that row.`,
      `Type the "Name" and press "Add".`,
      `Put ${lower(t.site.many)} in it with "Move to ${lower(t.territory.one)}" under "Coverage" on the "${t.staff.many}" page.`,
    ],
  },

  /* ------------------------------------------------------------------ team */
  {
    id: "add-rep",
    title: (t) => `Add ${withArticle(t, "staff")}`,
    page: "/settings/users",
    steps: () => [
      `Open "People & permissions" in the menu and press "Add a person".`,
      `Fill in the "Full name" and "Mobile number". The email is optional.`,
      `Choose a "Job role" that says they will be able to sign in to the Android app.`,
      `Type a "Starting password", or press the button next to it to make one, then press "Create account".`,
      `Press "Send on WhatsApp" or "Copy message" to give them their sign-in details, then press "Done".`,
    ],
  },
  {
    id: "deactivate-rep",
    title: (t) => `Turn off ${withArticle(t, "staff")}`,
    page: "/representatives",
    steps: (t) => [
      `Open "${t.staff.many}" in the menu.`,
      `Press "Manage" next to the ${lower(t.staff.one)}.`,
      `Press "Deactivate ${lower(t.staff.one)}". Their ${lower(t.job.one)} history is kept, and no new work goes to them.`,
      `Press "Reactivate ${lower(t.staff.one)}" in the same place to bring them back.`,
    ],
  },
  {
    id: "reset-rep-password",
    title: (t) => `Reset ${withArticle(t, "staff")}'s password`,
    page: "/representatives",
    steps: (t) => [
      `Open "${t.staff.many}" in the menu.`,
      `Press "Manage" next to the ${lower(t.staff.one)}.`,
      `Type a new password under "Set a new password", or press the button next to it to make one.`,
      `Press "Set".`,
      `Give them the new password straight away. It can't be looked up later.`,
    ],
  },

  /* ---------------------------------------------------- products and prices */
  {
    id: "add-product",
    title: () => "Add a product",
    page: "/products",
    steps: () => [
      `Open "Products" in the menu and press "New product".`,
      `Fill in the "Name", "Brand" and "Category".`,
      `Add the barcodes, "Units per shrink" and "SKU code" if you have them.`,
      `Type the "Shrink price excl. VAT" and the unit cost.`,
      `Press "Create product".`,
    ],
  },
  {
    id: "import-products",
    title: () => "Import products from a price card",
    page: "/products",
    steps: () => [
      `Open "Products" in the menu and press "Import".`,
      `Choose your spreadsheet, with one row per product.`,
      `Check what it will create and update.`,
      `Press the button that says how many it will create and update, then press "Close".`,
    ],
  },
  {
    id: "change-product-price",
    title: () => "Change a product's price",
    page: "/products",
    steps: (t) => [
      `Open "Products" in the menu.`,
      `Press the three dots at the end of the product's row and choose "Edit".`,
      `Change the "Shrink price excl. VAT" or "Shrink price incl. VAT".`,
      `Press "Save changes".`,
      `Use the "Price lists" tab for a ${lower(t.site_group.one)} that pays a different price.`,
    ],
  },
  {
    id: "price-lists",
    title: (t) => `Give ${withArticle(t, "site_group")} its own prices`,
    page: "/products/price-lists",
    steps: (t) => [
      `Open "Products" in the menu, then the "Price lists" tab.`,
      `Press "New price list", or "Edit" next to one you already have.`,
      `Give it a "Name" and tick the ${lower(t.site_group.many)} it is for under "Used by these ${lower(t.site_group.many)}".`,
      `Type this list's price per case in each product's box. Leave a box empty to charge the product's own price.`,
      `Press "Save price list".`,
    ],
  },

  /* --------------------------------------------------------------- schedule */
  {
    id: "schedule-add-visit",
    title: (t) => `Add ${withArticle(t, "job")} to the schedule`,
    page: "/schedule",
    steps: (t) => [
      `Open "Schedule" in the menu and press "Plan".`,
      `Choose the ${lower(t.staff.one)} under "${t.staff.one}".`,
      `Click the day on the calendar.`,
      `Search for the ${lower(t.site.many)} under "Add ${lower(t.site.many)} to this day".`,
      `Press "Add stop". It is on that date only and does not repeat.`,
    ],
  },
  {
    id: "schedule-move-visit",
    title: (t) => `Move or remove ${withArticle(t, "job")}`,
    page: "/schedule",
    steps: (t) => [
      `Open "Schedule" in the menu and press "Plan".`,
      `Choose the ${lower(t.staff.one)}, then click the day the ${lower(t.job.one)} is on.`,
      `Press "Remove" next to the ${lower(t.site.one)}.`,
      `Click the new day and add the ${lower(t.site.one)} there with "Add stop", if you are moving it.`,
      `Change its day on the "${t.schedule_cycle.one}" tab to move it for good, or generating again puts it back.`,
    ],
  },
  {
    id: "generate-schedule",
    title: (t) => `Generate the schedule from the ${lower(t.schedule_cycle.one)}`,
    page: "/schedule",
    steps: (t) => [
      `Open "Schedule" in the menu and press "${t.schedule_cycle.one}".`,
      `Choose a ${lower(t.staff.one)}, press "By ${lower(t.site.one)}", and give each ${lower(t.site.one)} a "Day" and "Frequency".`,
      `Choose how far ahead to plan under "Horizon".`,
      `Press "Generate schedule". It covers every ${lower(t.staff.one)}, not only the one you chose.`,
      `Read what it will change, then press the button that says how many routes it will create.`,
    ],
  },

  /* ---------------------------------------------------------------- targets */
  {
    id: "set-targets",
    title: () => "Set monthly targets",
    page: "/targets",
    steps: (t) => [
      `Open "Reports" in the menu, then the "Targets" tab.`,
      `Use the arrows at the top to choose the month.`,
      `Choose the "Measure" for each ${lower(t.staff.one)} and type their "Target".`,
      `Press "Save targets".`,
      `Press "Copy last month's targets" to start from last month's.`,
    ],
  },

  /* ----------------------------------------------------------------- orders */
  {
    id: "capture-order",
    title: () => "Take an order by hand",
    page: "/orders",
    steps: (t) => [
      `Open "Orders" in the menu and press "Capture an order".`,
      `Search for the ${lower(t.site.one)} under "${t.site.one}".`,
      `Choose "How did it arrive?" and the "${t.staff.one} responsible".`,
      `Search for each product and type the quantity. Press "Add a line" for another one.`,
      `Press "Save order". It waits under "Purchase orders" on the board.`,
    ],
  },
  {
    id: "order-steps",
    title: () => "Move an order from confirmed to delivered",
    page: "/orders",
    steps: (t) => [
      `Open "Orders" in the menu and open the order.`,
      `Press "Confirm and reserve", check "Fulfil from", then press "Confirm".`,
      `Press "Start picking", fill in what was picked, then press "Pack and finish".`,
      `Press "Dispatch", choose the ${lower(t.staff.one)} who is handling it, then press "Dispatch".`,
      `Press "Record delivery" when it arrives, fill in who took delivery, then press "Record delivery". Press "Upload POD" for the signed proof of delivery.`,
      `Press the button on the order's card on the board to do the next step from there, or drag the card to the next column.`,
    ],
  },
  {
    id: "hold-or-cancel-order",
    title: () => "Hold or cancel an order",
    page: "/orders",
    steps: () => [
      `Open "Orders" in the menu and open the order.`,
      `Press "Hold" to freeze it where it is, or "Cancel" to cancel it. An order that has been dispatched can't be cancelled.`,
      `Type the "Reason", then press "Hold it" or "Cancel the order".`,
      `Press "Release hold" on the order when it can carry on.`,
    ],
  },
  {
    id: "recurring-order",
    title: () => "Set up a recurring order",
    page: "/recurring-orders",
    steps: (t) => [
      `Open "Recurring orders" in the menu and press "New recurring order".`,
      `Give it a "Name", and choose the ${lower(t.site.one)} and the ${lower(t.staff.one)}.`,
      `Choose "How often" and the "First order on" date. Fill in "Stop after (orders)" if it should end.`,
      `Add the products and quantities, then press "Save recurring order".`,
      `Open it and press "Pause" to stop it for a while, and "Resume" to start it again.`,
    ],
  },

  /* ------------------------------------------------------------------ stock */
  {
    id: "receive-stock",
    title: () => "Receive stock",
    page: "/inventory",
    steps: () => [
      `Open "Inventory" in the menu and press "Receive stock".`,
      `Press "Receive a delivery".`,
      `Fill in the delivery: "Received into", the supplier and the invoice number.`,
      `Add each product under "What arrived" with its quantity. Press "Add a line" for another one.`,
      `Press "Save draft", then "Post into stock".`,
    ],
  },
  {
    id: "stocktake",
    title: () => "Do a stocktake",
    page: "/inventory",
    steps: () => [
      `Open "Inventory" in the menu and press "Stocktakes".`,
      `Press "Start a count", choose the "Location" and "Type", then press "Start counting".`,
      `Type what you counted on each line. Press "Save counts" to carry on later.`,
      `Press "Hand the sheet in" when every line is counted.`,
      `Press "Approve" to correct the stock to the count, or "Reject" to leave it as it is.`,
    ],
  },
  {
    id: "adjust-stock",
    title: () => "Adjust stock",
    page: "/inventory",
    steps: () => [
      `Open "Inventory" in the menu and press "Adjustments".`,
      `Press "Raise an adjustment".`,
      `Choose the "Location" and the "Reason", and add a note.`,
      `Choose each product under "Which stock" and type the quantity.`,
      `Press "Save draft", then "Submit for approval".`,
      `Press "Approve" on it to change the stock.`,
    ],
  },

  /* ------------------------------------------------------------------ money */
  {
    id: "create-quote",
    title: () => "Create and send a quote",
    page: "/quotes",
    steps: (t) => [
      `Open "Quotes" in the menu and press "New quote".`,
      `Under "${t.client.one}", choose "A ${lower(t.site.one)} on the books" and search for it, or choose "Someone new" and fill in their name and email.`,
      `Add the products or lines, with the quantity and price.`,
      `Press "Save and send".`,
      `Check the address under "To", add a note if you like, then press "Send".`,
    ],
  },
  {
    id: "quote-to-invoice",
    title: () => "Turn a quote into an invoice",
    page: "/quotes",
    steps: (t) => [
      `Open "Quotes" in the menu and open the quote.`,
      `Press "Accepted" once the ${lower(t.client.one)} says yes.`,
      `Press "Invoice the whole quote" under "Invoicing", or "Invoice a deposit" to bill part of it first.`,
      `Press "Convert to order" instead if the quote has products on it, and invoice the order when it goes out.`,
    ],
  },
  {
    id: "invoice-order",
    title: () => "Invoice an order",
    page: "/orders",
    steps: () => [
      `Open "Orders" in the menu and open the order once it has been dispatched. Delivered orders are under "Archive".`,
      `Press "Issue tax invoice" next to "Invoice", then press OK.`,
      `Press the invoice number next to "Invoice" if it already shows one. Some companies get the invoice when the order is confirmed.`,
    ],
  },
  {
    id: "send-invoice",
    title: () => "Send an invoice",
    page: "/invoices",
    steps: () => [
      `Open "Invoices" in the menu and open the invoice.`,
      `Press "Send to client".`,
      `Check the address under "To", and add a note if you like.`,
      `Press "Send".`,
    ],
  },
  {
    id: "record-payment",
    title: () => "Mark an invoice as paid",
    page: "/invoices",
    steps: () => [
      `Open "Invoices" in the menu and open the invoice.`,
      `Press "Record payment".`,
      `Fill in the "Amount", "Paid on", "Method" and "Reference".`,
      `Press "Save payment".`,
    ],
  },
  {
    id: "credit-note",
    title: () => "Issue a credit note",
    page: "/invoices",
    steps: () => [
      `Open "Invoices" in the menu and open the invoice.`,
      `Press "Credit note".`,
      `Type the "Reason", and how much of each line to credit under "Credit qty".`,
      `Press "Issue credit note".`,
    ],
  },
  {
    id: "send-statement",
    title: () => "Send a statement",
    page: "/statements",
    steps: (t) => [
      `Open "Invoices" in the menu, then the "Statements" tab.`,
      `Choose the ${lower(t.client.one)} on the left.`,
      `Choose the period, like "This month" or "Last month", or set "From" and "To".`,
      `Press "Send to client", check the address under "To", then press "Send".`,
      `Press "Download PDF" instead for a copy of your own.`,
    ],
  },
  {
    id: "who-owes-you",
    title: () => "See who owes you and remind them",
    page: "/owed",
    steps: (t) => [
      `Open "Who owes you" in the menu.`,
      `Change the "As at" date to see another day.`,
      `Press "Statement" next to a ${lower(t.client.one)} to see what they owe.`,
      `Press "Send reminder", read the message, then press "Send".`,
      `Tick several ${lower(t.client.many)} and press "Remind selected" to remind them one after the other.`,
    ],
  },

  /* ------------------------------------------------------------------ forms */
  {
    id: "create-form",
    title: () => "Create a form",
    page: "/forms",
    steps: (t) => [
      `Open "Forms" in the menu and press "New form".`,
      `Choose a starting point under "Start from", or keep "A blank form".`,
      `Type the "Name" and a "Description".`,
      `Tick "Compulsory" if ${lower(t.staff.many)} must send it in before they check out.`,
      `Press "Create form".`,
    ],
  },
  {
    id: "add-form-questions",
    title: () => "Add questions to a form",
    page: "/forms",
    steps: () => [
      `Open "Forms" in the menu and press "Edit" next to the form.`,
      `Press "Add field".`,
      `Type the question under "Label" and choose its "Type". For a choice, type the options with commas between them.`,
      `Tick "Required" if it must be answered, then press "Add field".`,
      `Use the up and down arrows next to a question to change the order.`,
    ],
  },
  {
    id: "make-form-compulsory",
    title: () => "Make a form compulsory",
    page: "/forms",
    steps: (t) => [
      `Open "Forms" in the menu and press "Edit" next to the form.`,
      `Tick "Compulsory". It saves straight away, and ${lower(t.staff.many)} can't check out until the form is sent in.`,
      `Untick it to make the form optional again.`,
    ],
  },
  {
    id: "archive-form",
    title: () => "Archive a form",
    page: "/forms",
    steps: () => [
      `Open "Forms" in the menu.`,
      `Press the bin button next to the form.`,
      `Press "Archive form". It comes off the phones, and its answers are kept.`,
      `Press "Delete permanently" instead for a form nobody has filled in yet, which can't be archived.`,
      `Press the bin button again and "Restore form" to bring an archived form back.`,
    ],
  },

  /* ------------------------------------------------------------- promotions */
  {
    id: "create-promotion",
    title: () => "Set up a promotion",
    page: "/promotions",
    steps: (t) => [
      `Open "Promotions" in the menu and press "New promotion".`,
      `Type the "Name" and what the ${lower(t.staff.one)} should look for.`,
      `Set the "Starts" and "Ends" dates.`,
      `Tick the products under "Lines" and the ${lower(t.site.many)} under "${t.site.many}". Press "All" next to a ${lower(t.site_group.one)} to tick all of its ${lower(t.site.many)}.`,
      `Press "Create promotion".`,
    ],
  },
  {
    id: "promotion-stores",
    title: (t) => `See which ${lower(t.site.many)} are running a promotion`,
    page: "/promotions",
    steps: (t) => [
      `Open "Promotions" in the menu.`,
      `Click the promotion.`,
      `Press "Running" to see the ${lower(t.site.many)} where it is running.`,
      `Press "Not running", "Not checked" or "Doesn't stock these" to see the rest.`,
    ],
  },

  /* -------------------------------------------------------------- dashboard */
  {
    id: "customise-dashboard",
    title: () => "Customise the dashboard",
    page: "/",
    steps: () => [
      `Open "Dashboard" in the menu and press "Customise".`,
      `Press "Add" next to a card under "Available" to put it on your dashboard.`,
      `Press the cross next to a card to take it off.`,
      `Use the up and down arrows, or drag a card, to change the order.`,
      `Press "Save layout". It changes only your own dashboard. "Reset to default" puts the usual cards back.`,
    ],
  },

  /* ---------------------------------------------------------------- reports */
  {
    id: "download-report",
    title: () => "Download a report",
    page: "/reports",
    steps: () => [
      `Open "Reports" in the menu.`,
      `Choose the report from the tabs at the top, and the view under it.`,
      `Set the dates and filters you want.`,
      `Press the button at the top right that starts with "Export", and choose Excel, PDF or CSV.`,
    ],
  },
  {
    id: "rep-performance-report",
    title: (t) => `Get ${withArticle(t, "staff")}'s performance report`,
    page: "/reports",
    steps: (t) => [
      `Open "Reports" in the menu and press the "Team" tab.`,
      `Set the dates at the top, then press the ${lower(t.staff.one)}'s name. Their report opens for those dates.`,
      `Choose another ${lower(t.staff.one)} or other dates under "Report controls" and press "Generate Report" to change it.`,
      `Press "Print / Save as PDF" and choose Save as PDF to keep or send it.`,
    ],
  },

  /* --------------------------------------------------------------- settings */
  {
    id: "business-details",
    title: () => "Change the company's details",
    page: "/settings/business",
    steps: () => [
      `Open "Settings" in the menu. The "Business" tab opens.`,
      `Change what you need under "Business details", like the "Business name", "Business address" or "Phone".`,
      `Press "Save changes".`,
    ],
  },
  {
    id: "change-logo",
    title: () => "Change the company logo",
    page: "/settings/business",
    steps: () => [
      `Open "Settings" in the menu. The "Business" tab opens.`,
      `Go down to "Logo", under "Branding".`,
      `Choose the picture under "Upload a logo" or "Replace logo". It saves as soon as you pick it.`,
      `Use a PNG, JPEG or WebP picture of 1 MB or less.`,
    ],
  },
  {
    id: "working-days",
    title: (t) => `Change working days and ${lower(t.site.many)} per day`,
    page: "/settings/team",
    steps: (t) => [
      `Open "Settings" in the menu, then the "Team & Work" tab.`,
      `Press the days your team works under "Working days".`,
      `Type how many ${lower(t.site.many)} one ${lower(t.staff.one)} can get to in a day under "${t.site.many} per day".`,
      `Press "Save changes".`,
    ],
  },
  {
    id: "notifications",
    title: () => "Choose which reports and alerts are emailed",
    page: "/settings/notifications",
    steps: (t) => [
      `Open "Settings" in the menu, then the "Notifications" tab.`,
      `Choose when "${t.job.one} reports" go to your ${lower(t.client.many)}: "After every ${lower(t.job.one)}", "Once per day" or "Only when I send one".`,
      `Switch the alerts you want on or off under "Alerts".`,
      `Press "Save changes".`,
      `Press "Send me a test email" to see one arrive.`,
    ],
  },

  /* ------------------------------------------------------------------- plan */
  {
    id: "pay-for-plan",
    title: () => "Pay for the plan",
    page: "/settings/plan",
    steps: (t) => [
      `Open "Settings" in the menu, then the "Plan" tab.`,
      `Press "Choose a plan", or "Upgrade plan" if you already pay.`,
      `Choose "Monthly" or "Yearly, 2 months free", and set how many ${lower(t.staff.many)} you have.`,
      `Check the "Email for invoices and receipts", then press the button that starts with "Pay".`,
      `Fill in your card on the Paystack page that opens.`,
    ],
  },
  {
    id: "update-card",
    title: () => "Update the card for the plan",
    page: "/settings/plan",
    steps: () => [
      `Open "Settings" in the menu, then the "Plan" tab.`,
      `Press "Update card" under "Payment", or "Add a card" if there is none yet.`,
      `Fill in the new card on the Paystack page that opens.`,
    ],
  },

  /* ------------------------------------------------------------------ leads */
  {
    id: "move-lead",
    title: (t) => `Move ${withArticle(t, "prospect")} along`,
    page: "/leads",
    steps: (t) => [
      `Open "${t.prospect.many}" in the menu.`,
      `Find the ${lower(t.prospect.one)} on the board. Search, or choose a ${lower(t.staff.one)}, at the top.`,
      `Choose its new stage in the box on its card: "New", "Contacted", "Follow-up", "Converted" or "Lost".`,
      `Drag the card into the next column instead, if you prefer.`,
    ],
  },

  /* ------------------------------------------------------------------ files */
  {
    id: "share-file",
    title: (t) => `Share a file with your ${lower(t.staff.many)}`,
    page: "/files",
    steps: (t) => [
      `Open "Files" in the menu and press "Upload".`,
      `Press "Choose a file" and pick it.`,
      `Give it a "Name", and a description if you like.`,
      `Choose "Everyone", "Selected ${lower(t.staff.many)}" or "By ${lower(t.site_group.one)}" under "Who can see it", and tick who.`,
      `Press "Upload". ${t.staff.many} see it on their phone.`,
    ],
  },
];

export function helpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((h) => h.id === id);
}
