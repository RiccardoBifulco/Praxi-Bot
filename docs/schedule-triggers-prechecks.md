# Schedule triggers and deterministic prechecks

File and e-mail triggers run inside the scheduler that `bot serve` already starts and stops. No additional daemon or browser session is required. Existing webhook records and the `webhook_secret` API field continue to work.

## Configuration and API

The existing `POST /v1/schedules` and `PUT /v1/schedules/{id}` bodies accept two optional fields. Omission preserves the field on update; explicit `null` removes it. These fields, and edits to schedules already using them, are local-owner only. Bots can request them through the existing always-confirmed schedule tools. Full precheck source and the complete trigger definition appear in the existing scrollable approval prompt, in addition to the scheduled task text.

Example additions to an otherwise normal schedule body:

```json
{
  "trigger": {
    "kind": "file_watch",
    "path": "<watch-root>/invoices",
    "glob": "*.csv",
    "events": ["created", "modified"],
    "debounce_ms": 1000
  },
  "precheck": {
    "kind": "script",
    "code": "return true;"
  }
}
```

Use an explicit local workspace root. The file tools' configured roots take precedence; otherwise configure `<data dir>/schedule.toml`:

```toml
watch_roots = ["/home/me/projects"]
```

On Windows use a TOML literal path, for example `watch_roots = ['C:\Users\me\Projects']`. Empty/unresolved roots, filesystem/system roots, paths outside the roots, protected credential paths, and symlinks/reparse points are refused. Each snapshot visits at most 1,000 directory entries and 16 levels, applies the file tools' glob matching, and reads metadata only. Configure a narrower directory when these bounds are exceeded.

File metadata is polled every 30 seconds. The first successful poll establishes a baseline. Created/modified filenames are coalesced for `debounce_ms` (0–60,000); a schedule fires at most six batches per rolling minute, with excess retained for the next window. Snapshot/pending data and rate accounting are persisted. File contents never become trigger payloads.

An e-mail trigger is:

```json
{
  "trigger": {
    "kind": "email",
    "account": "work",
    "from_filter": "ann@example.com",
    "subject_filter": "invoice"
  }
}
```

The account is an existing connector account, scoped to the schedule's bot; no passwords or API keys belong in this definition. An empty sender filter is refused. Every two minutes the registered `email_search` connector reads INBOX headers. The daemon also checks sender and optional subject locally, using case-insensitive substring matching. Only message identity, sender, and subject are retained in a firing's input. Message bodies and attachments are never fetched for this purpose.

The first mailbox poll establishes a baseline of the newest 100 matches. Subsequent polls coalesce newly observed identities and persist an IMAP UID high-water mark. API mailboxes with opaque identities retain a bounded seen set; after 10,000 such identities, narrow/recreate the trigger to establish a fresh baseline. More than 100 arrivals between polls can exceed this connector search window. This initial implementation is a bounded notification poller, not an exactly-once mailbox delivery queue. UID validity/account replacement and complete mailbox catch-up need a cursor-based IMAP interface; the existing IMAP connector has no `list_new` cursor support.

A file/e-mail trigger owns its firing clock, so its stored timer specification does not fire independently. A legacy webhook can still coexist with a timer. Manual `run-now` continues to work.

## Read permission and conditions

The bot's effective **Schedule** permission for every precheck tool must be explicit `Allow`. `Ask`, `Deny`, unsupported limited grants, hidden tools, and always-ask tools are refused. Standing grants and `read_tools_skip_ask` do not waive this restriction. The actual registry's `ToolGate` authorizes each call, with a content-free intent audit before execution. Tools must declare `Effect::Read`; write, destructive, meta-delegation and script-recursion tools cannot run inside a precheck. The production redactor runs before results are handed back to script code.

`HashChanged` takes a registered Read tool and JSON input:

```json
{"kind":"hash_changed","tool":"fs_read","input":{"path":"/home/me/projects/status.txt"}}
```

The first successful output establishes a SHA-256 baseline and skips the firing. Equal output skips subsequent firings. Changed output starts one run and supplies its bounded result as external input. Definition changes reset the baseline.

`Script` is an async JavaScript function body, with the existing capability-free QuickJS runtime. Its only host capability is `await tools.call(name, input)`. Return a boolean or `{run: boolean, input: "optional external data"}`. There is no filesystem, module loader, process, or network API in JavaScript. Limits are 20 seconds, ten tool calls, a 32 MiB JS heap, and 64 KiB aggregate tool/final output. A CPU loop is interrupted by QuickJS on a blocking worker; awaited calls also share the deadline.

Known direct literal `tools.call` names are checked at creation, as are all `HashChanged` tools. Arbitrary dynamic JS control flow cannot be completely validated without executing it: dynamic/aliased calls always receive the same runtime gate and cannot request unattended approval. A denied call is a precheck error, even when JavaScript catches that error.

A false result increments `skipped_by_precheck` without creating a Run row or calling any model. A malformed result, denied read, tool failure, exhausted budget or timeout fails open: a run is started with a fixed failure note, never the upstream error text. Ten consecutive precheck errors pause future firings; watcher errors have a separate ten-error streak. A successful watcher poll cannot reset a failing precheck's streak. The tenth failed precheck still opens its run before the schedule stays paused.

GET/list schedule responses expose the configured precheck, nonsecret trigger, skip count, and maximum error streak. File/e-mail rows return `next_run_at_ms: null`: their stored legacy timer is inactive. Bot list and approval cards show the event source and polling cadence without invented future firing times. There is no new HTTP route.

## Source and approval boundary

Main does not yet contain PR #89's native content-taint/egress engine. This implementation does not claim to supply it. Every firing with trigger or precheck data uses a fresh isolated chat, an explicit `external_schedule` message role and a durable `turn:external_schedule:<id>` run kind. External data is JSON encoded and labeled untrusted in the model input; it is never substituted into the saved owner definition. `Schedule` and source-specific policy denials continue to apply.

The run has a conservative once-only approval floor on **every tool**, including reads. Existing grants/read shortcuts cannot waive it, and approvals cannot create a standing grant. Children inherit the floor; recovery/resume reconstruct it from durable run ancestry. The router and recalled memory do not upgrade external text to trusted intent. CLI provider execution is refused because host per-tool approval cannot contain its native tools. These isolated chats cannot accept ordinary follow-up/steering messages; use a new chat to continue a human conversation.

For typed workflow/tool payloads, `{input}` is bound only in the firing's copy after the source boundary has been established, and the directive still passes the normal per-tool gate. Ordinary schedules without external input or prechecks retain their existing behavior. This stronger interactivity is deliberate until native source-taint integration exists.

## Persistence and limits

Migration `0012_triggers_prechecks.sql` is the fifth migration of the independent `schedules.db` store, so its `user_version` is 5. The filename reservation avoids conflicts with concurrent feature work; unrelated application-storage migrations are unchanged. It adds nullable `precheck_json` and `schedule_checks` runtime bookkeeping; old webhook JSON needs no rewrite.

Definitions and non-webhook triggers are committed atomically, and asynchronous check/poll results are discarded if the definition revision changed. Trigger state is bounded; the existing scheduler occurrence recovery contract still marks unresolved starts missed/interrupted rather than claiming exactly-once delivery after a process crash. Watcher dispatch follows that same best-effort crash boundary.

The existing CLI startup wires the live registry (including e-mail) before starting the scheduler. Up to four source polls run concurrently; a slow mailbox cannot hold the timer loop or all other source polls. Shutdown cancels polls and uses the existing in-flight drain. No shell, real account, real browser or desktop is needed by the deterministic test suites.
