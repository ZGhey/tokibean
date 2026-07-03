// Runtime UI language, decided once from the system locale:
//   Chinese for `zh*` locales, English for everything else (per product spec).
// The frontend mirrors this via navigator.language; both read the OS locale so they agree.

use std::sync::OnceLock;

/// True when the system language is Chinese.
pub fn is_zh() -> bool {
    static ZH: OnceLock<bool> = OnceLock::new();
    *ZH.get_or_init(|| {
        sys_locale::get_locale()
            .map(|l| l.to_lowercase().starts_with("zh"))
            .unwrap_or(false)
    })
}

/// Pick the Chinese or English variant for the current system language.
pub fn t(zh: &'static str, en: &'static str) -> &'static str {
    if is_zh() {
        zh
    } else {
        en
    }
}

/// Two-letter tag ("zh" | "en") handed to the frontend so it renders in the same language.
pub fn tag() -> &'static str {
    if is_zh() {
        "zh"
    } else {
        "en"
    }
}
