"""Tokibean desktop pet plugin for Hermes Agent.

Forwards lifecycle events to the local tokibean pet via HTTP POST.
"""
import json
import os
import urllib.request

# --- Baked by installer ---
TOKIBEAN_PORT = 8737
# --- End baked block ---

def _profile():
    """Detect the Hermes profile name from HERMES_HOME env var.
    If HERMES_HOME is ~/.hermes/profiles/<name>, use <name>.
    Otherwise use 'default'."""
    hh = os.environ.get("HERMES_HOME", "")
    if "/profiles/" in hh:
        return os.path.basename(hh)
    return "default"

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


def _send(event, **kwargs):
    mapped = EVENT_MAP.get(event, event)
    payload = {
        "hook_event_name": mapped,
        "session_id": kwargs.get("session_id", ""),
        "tool_name": kwargs.get("tool_name", ""),
        "tool_input": kwargs.get("args") if isinstance(kwargs.get("args"), dict) else {},
        "cwd": kwargs.get("cwd", ""),
    }

    if event == "post_llm_call":
        payload["last_assistant_message"] = kwargs.get("assistant_response", "")

    if event == "post_tool_call" and kwargs.get("status") == "error":
        payload["tool_response"] = {"is_error": True}

    if event == "pre_approval_request":
        desc = kwargs.get("description", "")
        cmd = kwargs.get("command", "")
        payload["message"] = f"{desc}: {cmd}" if desc else cmd

    url = f"http://127.0.0.1:{TOKIBEAN_PORT}/event/hermes?profile={_profile()}"
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


def pre_tool_call(tool_name, args, session_id="", **kw):
    _send("pre_tool_call", tool_name=tool_name, args=args, session_id=session_id)


def post_tool_call(tool_name, args, result, session_id="", status=None, **kw):
    _send("post_tool_call", tool_name=tool_name, args=args, session_id=session_id,
          status=status, result=result)


def pre_llm_call(session_id="", user_message="", **kw):
    _send("pre_llm_call", session_id=session_id)


def post_llm_call(session_id="", assistant_response="", **kw):
    _send("post_llm_call", session_id=session_id, assistant_response=assistant_response)


def on_session_start(session_id="", **kw):
    _send("on_session_start", session_id=session_id)


def on_session_end(session_id="", **kw):
    _send("on_session_end", session_id=session_id)


def subagent_stop(parent_session_id="", child_summary="", child_status="", **kw):
    _send("subagent_stop", session_id=parent_session_id)


def pre_approval_request(session_key="", command="", description="", **kw):
    _send("pre_approval_request", session_id=session_key, command=command,
          description=description)


def register(ctx):
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)
    ctx.register_hook("pre_llm_call", pre_llm_call)
    ctx.register_hook("post_llm_call", post_llm_call)
    ctx.register_hook("on_session_start", on_session_start)
    ctx.register_hook("on_session_end", on_session_end)
    ctx.register_hook("subagent_stop", subagent_stop)
    ctx.register_hook("pre_approval_request", pre_approval_request)
