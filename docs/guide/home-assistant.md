# Home Assistant

Bots can read your Home Assistant entities and call services (turn a light on,
set a thermostat). Every call goes through the permission engine.

## Set it up

1. In Home Assistant, open your profile and create a **long-lived access
   token**.
2. Store it in the secret store (never in a config file):

   ```
   bot secrets set homeassistant/token
   ```

3. Create `<data dir>/homeassistant.toml`:

   ```toml
   url = "http://homeassistant.local:8123"
   token = "homeassistant/token"             # reference, not the token
   allowed_domains = ["light", "switch"]     # optional: limit what may be called
   ```

4. Restart `bot serve`.

## Tools

| Tool | Effect | Notes |
| --- | --- | --- |
| `ha_list_entities` | read | States, optionally of one domain. Names are untrusted text. |
| `ha_get_state` | read | One entity with attributes. |
| `ha_call_service` | destructive | Acts on the real world, so it always asks. |

## Safety

- `https`, or plain `http` only for a home-network or localhost address.
- Redirects are never followed, so the token cannot be sent elsewhere.
- Services that run code or stop the hub are blocked for bots: `shell_command`,
  `python_script`, `pyscript`, `hassio`, `rest_command`, and
  `homeassistant.restart|stop|reload_all`, `recorder.purge*`.
- `allowed_domains` narrows the callable domains further (empty = any not blocked).
