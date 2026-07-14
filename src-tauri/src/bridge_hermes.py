#!/usr/bin/env python3
"""Tokibean bridge for Hermes Agent shell hooks.

Reads Hermes shell hook JSON from stdin, maps event/field names to tokibean's
canonical vocabulary, and curl-POSTs to the local tokibean hook server.

The port, agent name, and profile are baked in by tokibean's installer.
"""
import json
import subprocess
import sys

# --- Baked by installer ---
TOKIBEAN_PORT = "8737"
TOKIBEAN_AGENT = "hermes"
TOKIBEAN_PROFILE = "default"
# --- End baked block ---

EVENT_MAP = {
    "pre_tool_call": "PreToolUse",
    "post_tool_call": "PostToolUse",
    "pre_llm_call": "UserPromptSubmit",
    "post_llm_call": "Stop",
    "pre_approval_request": "Notification",
    "on_session_start": "SessionStart",
    "on_session_end": "SessionEnd",
    "subagent_stop": "SubagentStop",
}


def main():
    try:
        payload = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, OSError):
        print("{}")
        return

    event = payload.get("hook_event_name", "")
    if not event:
        print("{}")
        return

    mapped = EVENT_MAP.get(event, event)
    extra = payload.get("extra", {})

    # Build a Claude-compatible payload from Hermes shell hook JSON.
    # Top-level fields that match Claude Code's hook format:
    out = {
        "hook_event_name": mapped,
        "session_id": payload.get("session_id") or extra.get("session_key", ""),
        "tool_name": payload.get("tool_name") or "",
        "tool_input": payload.get("tool_input") if isinstance(payload.get("tool_input"), dict) else {},
        "cwd": payload.get("cwd", ""),
    }

    # post_llm_call: the Stop event's summary
    if event == "post_llm_call" and extra.get("assistant_response"):
        out["last_assistant_message"] = extra["assistant_response"]

    # post_tool_call: tool error detection
    if event == "post_tool_call" and extra.get("status") == "error":
        out["tool_response"] = {"is_error": True}
    elif event == "post_tool_call":
        out["tool_response"] = extra.get("result", "")

    # pre_approval_request: the notification message
    if event == "pre_approval_request":
        cmd = extra.get("command", "")
        desc = extra.get("description", "")
        out["message"] = f"{desc}: {cmd}" if desc else cmd

    url = f"http://127.0.0.1:{TOKIBEAN_PORT}/event/{TOKIBEAN_AGENT}"
    if TOKIBEAN_PROFILE:
        url += f"?profile={TOKIBEAN_PROFILE}"

    body = json.dumps(out, ensure_ascii=False)
    try:
        subprocess.run(
            ["curl", "-s", "-X", "POST", url,
             "-H", "Content-Type: application/json",
             "-d", body],
            timeout=10,
            capture_output=True,
        )
    except Exception:
        pass

    # Always return valid JSON — Hermes requires it on stdout.
    print("{}")


if __name__ == "__main__":
    main()
