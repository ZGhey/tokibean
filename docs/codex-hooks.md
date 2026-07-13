# Codex hooks: what "Completed" does and doesn't mean

Field notes from debugging a real Codex install (codex-cli 0.144.2, macOS, 2026-07-14). Everything
here was established by watching bytes on the wire, not by reading docs — and one of these facts is
the exact opposite of what Codex's own output tells you.

Read this before you believe *"the hooks are installed, so why is the pet asleep?"*

## 1. An unapproved hook prints `Completed` and runs nothing

Codex hashes every hook definition and refuses to execute it until you approve it via `/hooks` in its
TUI. Any edit re-arms that review. This is [ADR-0006](adr/0006-install-status-observed.md)'s whole
premise, and it holds. What is *not* obvious:

**Codex does not tell you it skipped the hook.** It prints, cheerfully:

```
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
```

…while never running the command. Proven by installing a hook whose only job was to append a line to
a file: no line, no file, `Completed`. The `Failed` / `Completed` verdicts refer to Codex's own
dispatch bookkeeping, not to your command's exit code.

So: **Codex's output is not evidence a hook ran.** The only evidence is an event arriving at the
server. That is precisely why the panel refuses to say *Active* until one does — the status is
*observed*, never *inferred* from what we wrote to disk.

If you need to confirm the gate is what's biting you, `codex --help` lists
`--dangerously-bypass-hook-trust`. Its existence is the tell. (Don't ship anything that relies on it.)

## 2. `hook: X Failed` is often somebody else's hook

Hooks from installed Codex *plugins* are registered alongside the ones in `~/.codex/hooks.json`, and
they all log under the same bare `hook: <Event>` label. On the machine these notes come from, the
`security-guidance@claude-plugins-official` plugin registered `session_start`, `user_prompt_submit`,
`stop` and `post_tool_use` — so every one of those events logged **twice**, one line ours and one
line theirs, and the `Failed` was consistently theirs.

The clean read is `PreToolUse`: no plugin registered it, so it appears exactly once, and that single
line is unambiguously Tokibean's. Check the registry before blaming your own hook:

```bash
grep -n "hooks.state" ~/.codex/config.toml     # every registered hook, ours and every plugin's
```

## 3. The imported-pollution trap

Codex's onboarding offers to import your Claude Code setup, and that import copies **Tokibean's own
hooks** verbatim into `~/.codex/hooks.json` — still pointing at the bare `/event` path, which means
*claude*. Approve those and your Codex work is silently counted as Claude's: inflated session badge,
wrong project labels, a polluted state machine.

`codex_install::plan()` strips them (only hooks bearing our own marker are ever touched — CONTEXT.md
invariant #8), and `incomplete()` reports the file as needing an install so the panel re-surfaces the
button. This was observed live, not theorized: a fresh Codex install on a machine that already ran
Tokibean arrives pre-polluted.

## 4. How to actually watch the wire

The pet owns port 8737, so stop it first, then listen yourself:

```python
# sniff.py — every hook POST, with its session id
import http.server, json, datetime
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode('utf-8', 'replace')
        d = json.loads(raw)
        print(f"{datetime.datetime.now():%H:%M:%S} {self.path} {d.get('hook_event_name')} "
              f"sid={str(d.get('session_id'))[:8]}", flush=True)
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(b'{}')          # every agent requires valid JSON on stdout (ADR-0008)
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 8737), H).serve_forever()
```

One trap while reading its output: **if you are running Claude Code in that same terminal, its hooks
POST to the same port.** Filter by `session_id` or you will happily mistake your own tool calls for
Codex's, and conclude the integration works when nothing arrived at all.

## Checklist when Codex events don't show up

1. Did an event ever arrive? (Panel says *Active*, or the sniffer above prints a line.) If yes, this
   document is not your problem.
2. Are the hooks approved? `/hooks` inside Codex. Codex's `Completed` proves nothing (§1).
3. Do they point at `/event/codex`, not `/event`? (§3 — check with
   `python3 -c "import json,os;print(open(os.path.expanduser('~/.codex/hooks.json')).read())"`.)
4. Is the `Failed` line even ours? (§2 — check `hooks.state` in `config.toml`.)
5. Is the pet actually listening? `lsof -nP -iTCP:8737 -sTCP:LISTEN`.
