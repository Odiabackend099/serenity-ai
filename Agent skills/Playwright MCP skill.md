# Playwright MCP Skill

**Purpose:** Browser automation for any web task — navigating sites, filling forms, reading dashboards, checking emails, clicking buttons, verifying page content.

**Status:** Production Ready | Last Updated: April 7, 2026

---

## PART 1 — BEFORE YOU USE ANY PLAYWRIGHT TOOL (READ FIRST)

### Step A: Check that the tools are available

Playwright tools are **deferred** in Claude Code. They do NOT appear in your tool palette automatically — you must fetch their schemas via `ToolSearch` before calling them. Do this ONCE at the start of any session that uses Playwright:

```
ToolSearch query: "browser_tabs browser_navigate browser_snapshot"
```

Or fetch specific tools you need:

```
ToolSearch query: "select:mcp__playwright__browser_tabs,mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_click,mcp__playwright__browser_type,mcp__playwright__browser_fill_form,mcp__playwright__browser_wait_for,mcp__playwright__browser_take_screenshot,mcp__playwright__browser_press_key,mcp__playwright__browser_snapshot,mcp__playwright__browser_network_requests"
```

After ToolSearch returns the schema, the tools are callable. **Do not wait for user confirmation — proceed immediately.**

### Step B: Confirm MCP is connected

```bash
claude mcp list
# Must show: playwright: ... ✓ Connected
```

If it shows `✓ Connected` and ToolSearch returned schemas → you're ready. Skip to Part 2.

### What if tools are NOT listed in the session's deferred tools at all?

If `mcp__playwright__browser_*` tools are **absent from the system-reminder's deferred tools list entirely**, the MCP server is not connected to this session. This happens when VSCode was open before the config was loaded.

Fix: Ask the user to do `Cmd+Shift+P` → **Developer: Reload Window**, then start a new chat. Do not attempt to use Playwright tools if MCP is not connected.

---

## PART 2 — HOW THE CONFIG WORKS (FOR DEBUGGING ONLY)

Claude Code starts Playwright MCP automatically at session start from `~/.claude.json` (user-scoped, applies to ALL projects and sessions):

```json
"playwright": {
  "type": "stdio",
  "command": "/usr/local/opt/node@20/bin/npx",
  "args": [
    "@playwright/mcp@latest",
    "--browser", "chrome",
    "--user-data-dir", "/Users/mac/Library/Caches/ms-playwright/mcp-chrome"
  ],
  "env": {}
}
```

Redundant backup also in `/Users/mac/Downloads/dropship.barpel/.mcp.json`.

You do NOT manually start or restart the Playwright process. Claude Code owns the lifecycle.

---

## PART 3 — STANDARD USAGE PATTERN

### Step 1: Open a new tab (ALWAYS first — never hijack existing tabs)

```
mcp__playwright__browser_tabs  action: "new"
```

### Step 2: Navigate

```
mcp__playwright__browser_navigate  url: "https://example.com"
```

The navigate result already includes a mini-snapshot. Call `browser_snapshot` only if you need full element refs.

### Step 3: Snapshot to get element refs

```
mcp__playwright__browser_snapshot
```

Returns all elements with refs like `[ref=e123]`. Use these refs for clicking/typing. **Refs expire on navigation — always re-snapshot after any page change.**

### Step 4: Interact

**Fill multiple fields at once (preferred):**
```
mcp__playwright__browser_fill_form
  fields: [
    { name: "Email", type: "textbox", ref: "e21", value: "you@example.com" },
    { name: "Password", type: "textbox", ref: "e25", value: "secret123" }
  ]
```

**Click:**
```
mcp__playwright__browser_click  ref: "e123"  element: "Submit button"
```

**Type into a single field:**
```
mcp__playwright__browser_type  ref: "e456"  text: "your text"
```

**Press key:**
```
mcp__playwright__browser_press_key  key: "Enter"
```

**Wait (SECONDS, not ms):**
```
mcp__playwright__browser_wait_for  time: 3
```

**Screenshot (to visually verify what's on screen):**
```
mcp__playwright__browser_take_screenshot
```

### Step 5: Close your tab when done

```
mcp__playwright__browser_tabs  action: "close"
```

---

## PART 4 — RULES THAT PREVENT ERRORS AND HALLUCINATION

### Rule 1: Refs expire — re-snapshot after every navigation

```
WRONG:
  navigate → click old ref           ❌ ref is from previous page

CORRECT:
  navigate → snapshot → click new ref ✅
```

### Rule 2: `time` in `browser_wait_for` is SECONDS, not milliseconds

```
{ time: 3 }     ✅ waits 3 seconds
{ time: 3000 }  ❌ waits 3000 seconds — do not do this
```

### Rule 3: Check if already logged in BEFORE attempting login

Many sites (Shopify, Zoho, Tapfiliate) keep sessions alive across browser restarts. Attempting to log in when already authenticated triggers 2FA/passkey popups that crash the browser to `about:blank`.

```
1. Navigate directly to the authenticated destination URL
2. Snapshot and read current URL
3. If URL = dashboard → already logged in, skip login entirely
4. If URL contains "login" or "accounts." → proceed with login
```

### Rule 4: After `about:blank` crash — navigate directly, don't panic

If a security popup crashed the page to `about:blank`, the session cookie may still be valid:

```
1. browser_navigate to your destination
2. browser_take_screenshot to verify
3. If you're on the page → session persisted, continue
4. If you're on login → log in normally
```

### Rule 5: Never kill Chrome — only kill stale MCP node processes

```bash
SAFE:    pkill -f "playwright-mcp"        # kills only MCP node processes
NEVER:   pkill -f "Google Chrome"         # destroys user's browser windows
```

### Rule 6: `browser_tabs` does NOT accept a `url` parameter for `action: "new"`

```
WRONG:  browser_tabs  action: "new"  url: "https://..."   ❌ url is not a valid param
CORRECT:
  browser_tabs      action: "new"
  browser_navigate  url: "https://..."                    ✅ two separate calls
```

---

## PART 5 — TROUBLESHOOTING

### "✗ Failed to connect" in `claude mcp list`

The MCP server is crashing before connecting. Known causes:

| Error message | Bad config | Fix |
|---------------|-----------|-----|
| `unknown option '--headed'` | `"--headed"` in args | Remove it — headed is the default in v0.0.70+ |
| Server exits in 2s silently | `user-data-dir: mcp-chrome-d8f4d2e` | Change to `mcp-chrome` (the `d8f4d2e` dir requires Chrome already running) |
| `command not found: npx` | `"command": "npx"` | Use full path: `"/usr/local/opt/node@20/bin/npx"` |

After fixing `~/.claude.json`:
```bash
claude mcp list  # verify ✓ Connected
# Then: Cmd+Shift+P → Developer: Reload Window
```

### "Browser is already in use"

Multiple playwright-mcp Node.js processes fighting for the same browser lock:
```bash
pkill -f "playwright-mcp" && sleep 3
# Then open a new tab — Claude Code restarts a fresh server
```

### "Target page, context or browser has been closed"

The tab was destroyed. Server is still running:
```
browser_tabs  action: "new"
browser_navigate  url: "https://..."
```

### Manual stdio test (when you need to isolate the command itself)

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  | /usr/local/opt/node@20/bin/npx @playwright/mcp@latest --browser chrome \
    --user-data-dir /Users/mac/Library/Caches/ms-playwright/mcp-chrome 2>/dev/null
# Returns JSON with "serverInfo" → command is fine, issue is in Claude Code config
# Returns nothing or error → fix the command
```

---

## PART 6 — TAB MANAGEMENT REFERENCE

```
List all tabs:           browser_tabs  action: "list"
Open new blank tab:      browser_tabs  action: "new"
Switch to tab by index:  browser_tabs  action: "select"  index: 0
Close current tab:       browser_tabs  action: "close"
Close specific tab:      browser_tabs  action: "close"   index: 2
```

Note: There is NO `url` parameter on `browser_tabs`. Open a new tab, then navigate separately.

---

## PART 7 — LOGIN PATTERN (SHOPIFY, ZOHO, TAPFILIATE)

```
1. Navigate directly to authenticated destination (skip login if session persists)
   browser_navigate  url: "https://partners.shopify.com/4822833/apps"
   browser_snapshot

2. Read current URL from snapshot header:
   - URL = expected dashboard → already authenticated, proceed
   - URL contains "accounts.shopify.com" or "/login" → need to log in

3. If login needed:
   browser_snapshot  (find email/password field refs)
   browser_type  ref: "eXX"  text: "austyn@barpel.ai"
   browser_click  ref: "eYY"  element: "Continue button"
   browser_snapshot  (re-snapshot for password page — refs changed)
   browser_type  ref: "eZZ"  text: "PASSWORD"
   browser_press_key  key: "Enter"
   browser_wait_for  time: 4
   browser_take_screenshot  (verify where you landed)

4. If page crashed to about:blank:
   browser_navigate  url: "https://destination.com"
   browser_take_screenshot  (session may still be valid)
```

---

## PART 8 — KNOWN ACCOUNTS (BARPEL)

| Site | URL | Account |
|------|-----|---------|
| Shopify Partners | partners.shopify.com/4822833 | austyn@barpel.ai |
| Barpel Drop AI app | dropship.barpel.ai | austyn@barpel.ai |
| Zoho Mail (barpel) | mail.zoho.com | austyn@barpel.ai |
| Zoho Mail (odia) | mail.zoho.eu | austyn@odia.dev |
| Tapfiliate | app.tapfiliate.com | austyn@barpel.ai |

Sessions are usually persistent. Always try navigating directly before logging in.

---

## QUICK REFERENCE CARD

```
SESSION START:
1. ToolSearch → fetch browser_tabs, browser_navigate, browser_snapshot, browser_click,
                     browser_type, browser_fill_form, browser_wait_for, etc.
2. claude mcp list → confirm ✓ Connected
3. browser_tabs  action: "new"         → open fresh tab
4. browser_navigate  url: "..."        → go to destination
5. browser_snapshot                    → get element refs
6. Interact using refs
7. browser_tabs  action: "close"       → clean up

KEY RULES:
- Fetch tools via ToolSearch first — they're deferred, not auto-available
- Re-snapshot after every navigation (refs expire)
- wait_for uses SECONDS not milliseconds
- Check session before login (navigate → snapshot → read URL)
- browser_tabs "new" has NO url param — navigate separately
- Only pkill playwright-mcp, never Chrome

IF BROKEN:
- Tools not in deferred list → MCP not connected → Reload VSCode window
- "already in use" → pkill -f playwright-mcp && sleep 2
- "target closed" → browser_tabs action: "new"
- "✗ Failed" → check ~/.claude.json (no --headed, use mcp-chrome not mcp-chrome-d8f4d2e)
```
