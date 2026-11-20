# Calendar (CalDAV)

Bots can read and add events in a CalDAV calendar (Nextcloud, Radicale,
Fastmail, iCloud, Synology ...). Every call goes through the permission engine
like any other tool.

## Set it up

1. Store the calendar password in the secret store (never in a config file):

   ```
   bot secrets set calendar/home/password
   ```

2. Create `<data dir>/calendar.toml`:

   ```toml
   [[calendar]]
   name = "home"
   url = "https://dav.example.com/calendars/me/personal/"   # the calendar collection
   username = "me"
   password = "calendar/home/password"                      # reference, not the password
   ```

3. Restart `bot serve`. The `calendar_*` tools appear for bots that are allowed
   to use them.

## Tools

| Tool | Effect | Notes |
| --- | --- | --- |
| `calendar_list_events` | read | Events overlapping a range; recurring events are expanded by the server. Titles and notes are untrusted text. |
| `calendar_create_event` | write | Adds one event. No attendees are written, so nobody is invited or notified. |
| `calendar_delete_event` | destructive | Deletes one event by `uid`; always asks. |

Dates are `YYYY-MM-DD` (whole day) or RFC 3339 with an offset.

## Safety

- The URL must be `https` (plain `http` only for a loopback host: `localhost`, `::1` or `127.*`, e.g. a test server).
- Redirects are never followed, so the password cannot be sent to another host.
- A server-supplied link is used for deleting only if it stays inside the
  configured calendar.
- Calendar text returned to the model is marked as untrusted data; a run that
  read it is tainted like one that read a web page or an e-mail.
