# Navigation: where every page lives

Simple navigation, deep pages. The sidebar shows the main areas of the
business; everything else is a tab inside one of them, a button on a page, or a
link from the dashboard. No route changed in this redesign, so every old link,
bookmark and dashboard tile still works.

One configuration drives every trade: `web/components/layout/nav-items.ts`.
The company's words (site, job, staff, territory) label the items, its modules
decide what exists, and the person's permissions decide what they see. A
company with the Distribution module gets the sales layout; every other
company gets the service layout.

## Service trades (no Distribution module)

| Section    | Sidebar item            | Route               | Tabs at the top of the page                                         |
|------------|-------------------------|---------------------|---------------------------------------------------------------------|
|            | Dashboard               | `/`                 |                                                                     |
| Customers  | {Sites}                 | `/stores`           | {Sites} · Location exceptions (`/stores/review`)                    |
|            | {Territories}           | `/territories`      |                                                                     |
| Operations | Schedule                | `/schedule`         |                                                                     |
|            | {Jobs}                  | `/visits`           | {Jobs} · Activity (`/activities`) · Off-site check-ins (`/visits/off-site`) |
|            | Tracking                | `/tracking`         | Live map · Vehicle logbook (`/logbook`)                             |
| Team       | {Staff}                 | `/representatives`  |                                                                     |
| Finance    | Quotes                  | `/quotes`           |                                                                     |
|            | Invoices                | `/invoices`         | Invoices · Contracts · Statements · Price list                      |
|            | Who owes you            | `/owed`             |                                                                     |
| Reports    | Reports                 | `/reports`          | Reports · {Staff} performance (`/reports/rep-performance`)          |
| People     | Employees               | `/hr/employees`     | Employees · Overview (`/hr`)                                        |
| (HR only)  | Attendance              | `/hr/attendance`    |                                                                     |
|            | Leave                   | `/hr/leave`         |                                                                     |
|            | Performance             | `/hr/performance`   |                                                                     |
|            | Documents               | `/hr/documents`     |                                                                     |
|            | Disciplinary            | `/hr/disciplinary`  |                                                                     |
| Admin      | People & permissions    | `/settings/users`   | (in page) People · Roles & permissions                              |
|            | Company settings        | `/settings/company` | Company · HR (`/hr/settings`) · Warehouse (`/warehouse/settings`)   |
| Resources  | Forms                   | `/forms`            |                                                                     |
|            | Files                   | `/files`            |                                                                     |

## Distribution (Distribution module on)

| Section    | Sidebar item        | Route               | Tabs at the top of the page                                    |
|------------|---------------------|---------------------|----------------------------------------------------------------|
|            | Dashboard           | `/`                 |                                                                |
| Sales      | {Stores}            | `/stores`           | {Stores} · Location exceptions                                 |
|            | {Leads}             | `/leads`            |                                                                |
|            | Orders              | `/orders`           |                                                                |
|            | Quotes              | `/quotes`           |                                                                |
|            | Promotions          | `/promotions`       |                                                                |
| Field team | Schedule            | `/schedule`         |                                                                |
|            | {Visits}            | `/visits`           | {Visits} · Activity · Off-site check-ins                       |
|            | Tracking            | `/tracking`         | Live map · Vehicle logbook                                     |
|            | {Reps}              | `/representatives`  |                                                                |
|            | {Territories}       | `/territories`      |                                                                |
| Inventory  | Products            | `/products`         |                                                                |
|            | Inventory           | `/inventory`        | (buttons) Receive · Adjustments · Transfers · Stocktakes       |
|            | Warehouse           | `/warehouse`        | (the dispatch and delivery board)                              |
|            | Recurring orders    | `/recurring-orders` |                                                                |
| Finance    | Invoices            | `/invoices`         | Invoices · Contracts · Statements · Price list                 |
|            | Who owes you        | `/owed`             |                                                                |
|            | Commissions         | `/commissions`      | (button) Commission rules                                      |
| Reports    | Reports             | `/reports`          | Reports · {Rep} performance · Sales · Targets · Warehouse insights |
| People, Admin and Resources are the same as for service trades.                                              |

## Old sidebar entry → new home

| Old entry (group)                         | Route                     | New home                                       |
|-------------------------------------------|---------------------------|------------------------------------------------|
| Dashboard                                 | `/`                       | Dashboard                                      |
| Sales (Insights)                          | `/sales`                  | Reports → Sales tab                            |
| Reports (Insights)                        | `/reports`                | Reports                                        |
| {Staff} performance (Insights)            | `/reports/rep-performance`| Reports → {Staff} performance tab              |
| Warehouse insights (Insights)             | `/warehouse/insights`     | Reports → Warehouse insights tab               |
| Targets (Insights)                        | `/targets`                | Reports → Targets tab                          |
| Commissions (Insights)                    | `/commissions`            | Finance → Commissions                          |
| Leads (Sales & Coverage)                  | `/leads`                  | Sales → Leads                                  |
| {Sites} (Sales & Coverage)                | `/stores`                 | Customers / Sales → {Sites}                    |
| {Territories} (Sales & Coverage)          | `/territories`            | Customers / Field team → {Territories}         |
| Schedule (Field Operations)               | `/schedule`               | Operations / Field team → Schedule             |
| Tracking (Field Operations)               | `/tracking`               | Operations / Field team → Tracking             |
| Vehicle logbook (Field Operations)        | `/logbook`                | Tracking → Vehicle logbook tab                 |
| {Jobs} & Activities (Field Operations)    | `/activities`             | {Jobs} → Activity tab                          |
| Promotions (Field Operations)             | `/promotions`             | Sales → Promotions                             |
| Quotes (Money)                            | `/quotes`                 | Finance (service) / Sales (distribution)       |
| Invoices (Money)                          | `/invoices`               | Finance → Invoices                             |
| Contracts (Money)                         | `/contracts`              | Finance → Invoices → Contracts tab             |
| Who owes you (Money)                      | `/owed`                   | Finance → Who owes you                         |
| Statements (Money)                        | `/statements`             | Finance → Invoices → Statements tab            |
| Price list (Money)                        | `/price-list`             | Finance → Invoices → Price list tab            |
| Warehouse (Warehouse & Fulfilment)        | `/warehouse`              | Inventory → Warehouse                          |
| Orders (Warehouse & Fulfilment)           | `/orders`                 | Sales → Orders                                 |
| Recurring orders (Warehouse & Fulfilment) | `/recurring-orders`       | Inventory → Recurring orders                   |
| Inventory (Warehouse & Fulfilment)        | `/inventory`              | Inventory → Inventory                          |
| Products (Warehouse & Fulfilment)         | `/products`               | Inventory → Products                           |
| Warehouse setup (Warehouse & Fulfilment)  | `/warehouse/settings`     | Admin → Company settings → Warehouse tab       |
| {Staff} (Sales Team)                      | `/representatives`        | Team / Field team → {Staff}                    |
| HR dashboard (Human Resources)            | `/hr`                     | People → Employees → Overview tab              |
| Employees … Disciplinary (Human Resources)| `/hr/*`                   | People                                         |
| HR settings (Human Resources)             | `/hr/settings`            | Admin → Company settings → HR tab              |
| My HR                                     | `/hr/me`                  | The profile menu, top right                    |
| Users & permissions (Administration)      | `/settings/users`         | Admin → People & permissions                   |
| Company profile (Administration, footer)  | `/settings/company`       | Admin → Company settings                       |
| Forms, Files (Resources)                  | `/forms`, `/files`        | Resources                                      |

Pages that were never in the sidebar and are now tabs: `/visits` (now the
{Jobs} item itself), `/visits/off-site`, `/stores/review`. `/plans` counts as
Company settings.

## Rules the configuration keeps

- An item or tab is shown only when the person may open it (`can` and
  `canAccessPath`), the company has its module (`canReachPath`) and, for money
  pages, the company's settings use it.
- An item whose own page the person cannot open links to the first of its tabs
  they can: an HR manager's Company settings opens HR settings, a warehouse
  clerk's opens Warehouse settings.
- A route belongs to exactly one item (tests enforce it), so one item is
  highlighted wherever you are.
- On a phone, a bar along the bottom holds the four most used destinations and
  "More", which opens the full menu.
