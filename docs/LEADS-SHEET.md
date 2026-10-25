# New leads: WhatsApp alert and Google Sheet

Every new Founding application is saved in the app (`/platform/founding`) and
emailed to the owner. Since 25 Oct 2026 it can also:

- **WhatsApp the owner** through CallMeBot, and
- **add a row to a Google Sheet**, for tracking the calls.

Both live in `web/lib/lead-alerts.ts` and stay off until their settings are in
Vercel (the `web` project → Settings → Environment Variables, Production). A
failed alert never loses the application, and the email still goes.

## 1. WhatsApp alert (CallMeBot)

1. Save **+34 644 71 81 99** in your phone's contacts (CallMeBot's number;
   check it on <https://www.callmebot.com/blog/free-api-whatsapp-messages/>,
   they change it now and then).
2. From your own WhatsApp, send it: `I allow callmebot to send me messages`
3. It answers with your API key.
4. In Vercel, add:
   - `CALLMEBOT_PHONE`: your WhatsApp number with its country code, digits
     only, for example `26776642259`
   - `CALLMEBOT_APIKEY`: the key it sent you
5. Redeploy the `web` project.

CallMeBot is a free, unofficial service: each lead's name, business, number and
email pass through it. Move to the WhatsApp Business API once the business line
exists.

## 2. Google Sheet

1. Make a new Google Sheet (for example "Tickd leads").
2. **Extensions → Apps Script**. Delete what is there and paste the script
   below. Change `CHANGE-ME` to a long secret word of your own.
3. **Deploy → New deployment → Select type: Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy, allow access, and copy the **Web app URL**.
4. In Vercel, add:
   - `LEADS_SHEET_URL`: the Web app URL
   - `LEADS_SHEET_SECRET`: the same secret word as in the script
5. Redeploy the `web` project.

The first lead writes the header row. The app decides the columns (see
`SHEET_HEADERS` in `web/lib/lead-alerts.ts`): when, every answer, the ad's
tags, then your columns "First call at", "Reached", "Score", "Sales call
booked" and "Notes", left empty for you. Don't move or insert columns before
"Notes"; add your own after it.

The "Ad set" column fills only when the ad links carry `utm_term`, for example
`utm_term={{adset.name}}` in the ad's URL parameters.

```js
// Tickd leads: the app posts each new application here (docs/LEADS-SHEET.md).
const SECRET = "CHANGE-ME";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return reply({ ok: false, error: "wrong secret" });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(body.headers);
        sheet.getRange(1, 1, 1, body.headers.length).setFontWeight("bold");
        sheet.setFrozenRows(1);
      }
      const row = sheet.getLastRow() + 1;
      // As plain text, so "+27..." and "3-5" stay as typed.
      sheet.getRange(row, 1, 1, body.row.length).setNumberFormat("@").setValues([body.row]);
    } finally {
      lock.releaseLock();
    }
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
```

To change the script later: edit it, then **Deploy → Manage deployments →
Edit → Version: New version → Deploy**. The URL stays the same.
