// hook 事件接收器
// Claude Code 的 hooks 会把事件 JSON POST 到 http://127.0.0.1:<port>/event
// 事件 JSON 里带 hook_event_name 和 session_id,按会话独立维护状态

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tiny_http::{Method, Response, Server};

use crate::state::{self, Base, Session, Shared};

pub fn run(app: AppHandle, shared: Arc<Shared>) {
    let (bind, port) = {
        let cfg = shared.cfg.lock().unwrap();
        (cfg.bind.clone(), cfg.port)
    };
    let server = match Server::http((bind.as_str(), port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[claude-pet] hook 服务器启动失败(端口 {} 被占用?):{}", port, e);
            return;
        }
    };
    println!("[claude-pet] hook 服务器已监听 {}:{}", bind, port);

    for mut request in server.incoming_requests() {
        let mut body = String::new();
        let _ = request.as_reader().read_to_string(&mut body);
        let ok = *request.method() == Method::Post;
        let _ = request.respond(Response::from_string("ok"));
        if !ok {
            continue;
        }
        handle_event(&app, &shared, &body);
    }
}

fn snippet(s: &str, max_chars: usize) -> String {
    let cleaned: String = s.chars().map(|c| if c == '\n' { ' ' } else { c }).collect();
    let mut out: String = cleaned.chars().take(max_chars).collect();
    if cleaned.chars().count() > max_chars {
        out.push('…');
    }
    out
}

/// 工具名 → 面向人的短语
fn friendly_tool(t: &str) -> String {
    let known = match t {
        "Bash" | "PowerShell" => "跑命令",
        "Edit" | "Write" | "NotebookEdit" => "改代码",
        "Read" => "读文件",
        "Grep" | "Glob" => "搜代码",
        "WebFetch" | "WebSearch" => "查资料",
        "Task" | "Agent" => "派子任务",
        "TodoWrite" | "TaskCreate" | "TaskUpdate" => "列计划",
        _ => "",
    };
    if !known.is_empty() {
        return known.to_string();
    }
    // mcp__server__tool 只留最后一段
    let short = t.rsplit("__").next().unwrap_or(t);
    format!("用 {}", snippet(short, 12))
}

fn handle_event(app: &AppHandle, shared: &Shared, body: &str) {
    let v: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return,
    };
    let name = v["hook_event_name"].as_str().unwrap_or("");
    if name.is_empty() {
        return;
    }
    shared.hooks_seen.store(true, Ordering::Relaxed);
    let (notify_on, notify_min) = {
        let cfg = shared.cfg.lock().unwrap();
        (cfg.notify, cfg.notify_min_secs)
    };
    let sid = v["session_id"].as_str().unwrap_or("default").to_string();

    // worked:本轮 Stop 前工作了多少秒,用于通知降噪和庆祝等级
    let mut worked: u64 = 0;

    {
        let mut core = shared.core.lock().unwrap();
        core.last_event = Some(name.to_string());
        let now = Instant::now();

        if name == "SessionEnd" {
            core.sessions.remove(&sid);
            // 注意:push_update 会再锁 core,必须先释放
            drop(core);
            state::push_update(app, shared);
            return;
        }

        let sess = core.sessions.entry(sid).or_insert(Session {
            base: Base::Idle,
            since: Instant::now(),
            done_until: None,
            last_seen: Instant::now(),
        });
        sess.last_seen = now;

        match name {
            "UserPromptSubmit" => {
                if sess.base != Base::Working {
                    sess.since = now;
                }
                sess.base = Base::Working;
                sess.done_until = None;
                core.bubble = None;
                core.tool_note = None;
            }
            "PostToolUse" => {
                // 工具出错 → 短暂的恼火动画
                let r = &v["tool_response"];
                let is_err = r["is_error"].as_bool().unwrap_or(false)
                    || !r["error"].is_null()
                    || r["success"].as_bool().map(|s| !s).unwrap_or(false);
                if is_err {
                    core.oops_until = Some(now + Duration::from_secs(4));
                }
            }
            "PreToolUse" => {
                // 兜底:错过 UserPromptSubmit 也能感知到在干活
                if sess.base != Base::Working {
                    sess.base = Base::Working;
                    sess.since = now;
                }
                if let Some(tool) = v["tool_name"].as_str() {
                    core.tool_note = Some((friendly_tool(tool), now + Duration::from_secs(10)));
                }
                // 后台任务发射:一颗小卫星入轨
                if v["tool_input"]["run_in_background"].as_bool().unwrap_or(false) {
                    core.bg_tasks.push(now + Duration::from_secs(15 * 60));
                }
            }
            "Stop" => {
                if sess.base == Base::Working {
                    worked = now.duration_since(sess.since).as_secs();
                }
                let level = if worked >= 600 { 2 } else if worked >= 60 { 1 } else { 0 };
                let dwell = if level == 2 { 20 } else { 12 };
                // sess 的写入全部做完,再碰 core 的其他字段(借用检查)
                sess.base = Base::Done;
                sess.since = now;
                sess.done_until = Some(now + Duration::from_secs(dwell));
                core.celebrate = core.celebrate.max(level);
                let msg = v["last_assistant_message"].as_str().unwrap_or("");
                let head = if worked >= 60 {
                    format!("完工·{}分钟", worked / 60)
                } else {
                    "完工".to_string()
                };
                let text = if msg.is_empty() {
                    format!("{}!", head)
                } else {
                    format!("{}:{}", head, snippet(msg, 40))
                };
                core.bubble = Some((text, now + Duration::from_secs(dwell)));
                core.tool_note = None;
                // 刚烧完一波 token,请求尽快刷一次官方用量(事件驱动)
                shared.official_want.store(true, Ordering::Relaxed);
                // 今日完工计数(跨天清零)
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                if core.stops_day != today {
                    core.stops_day = today;
                    core.stops_today = 0;
                }
                core.stops_today += 1;
            }
            "Notification" => {
                if sess.base != Base::Attention {
                    sess.since = now; // 焦急升级计时起点
                }
                sess.base = Base::Attention;
                sess.done_until = None;
                core.tool_note = None;
                let msg = v["message"].as_str().unwrap_or("");
                let text = if msg.is_empty() {
                    "在等你输入!".to_string()
                } else {
                    snippet(msg, 40)
                };
                core.bubble = Some((text, now + Duration::from_secs(120)));
            }
            "SessionStart" => {
                let anyone_busy = core
                    .sessions
                    .values()
                    .any(|s| s.base == Base::Working || s.base == Base::Attention);
                if !anyone_busy {
                    core.bubble = Some(("开工!".to_string(), now + Duration::from_secs(6)));
                }
            }
            _ => {} // SubagentStop 等先忽略
        }
    }

    // 系统通知:只对两个高价值事件发。
    // Stop 通知降噪:干了不到 notify_min_secs 的小活不打扰
    if notify_on {
        match name {
            "Stop" if worked >= notify_min => {
                let msg = v["last_assistant_message"].as_str().unwrap_or("");
                let body_text = if msg.is_empty() {
                    "本轮任务已完成".to_string()
                } else {
                    snippet(msg, 80)
                };
                state::notify(app, "Claude 完工了", &body_text);
            }
            "Notification" => {
                let msg = v["message"].as_str().unwrap_or("Claude 在等你输入或授权");
                state::notify(app, "Claude 在等你", &snippet(msg, 80));
            }
            _ => {}
        }
    }

    state::push_update(app, shared);
}
