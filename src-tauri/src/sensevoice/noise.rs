/// Check if transcribed text looks like noise (not meaningful speech).
/// Returns Some(noise_label) if it's noise, None if it's valid speech.
pub fn detect_noise(text: &str) -> Option<&'static str> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Some("（无声）");
    }

    // Filter known Whisper hallucinations (training data artifacts)
    let lower = trimmed.to_lowercase();
    let hallucination_patterns = [
        "字幕制作", "字幕提供", "字幕由", "字幕：", "字幕:",
        "感谢观看", "谢谢观看", "感谢收看",
        "请订阅", "订阅频道", "关注我",
        "下期再见", "下次再见",
        "subtitle", "subtitles", "caption",
        "thank you for watching", "thanks for watching",
        "please subscribe", "subscribe to",
        "自动生成", "自动字幕",
        "youtube", "bilibili", "youku",
    ];
    for pattern in &hallucination_patterns {
        if lower.contains(pattern) {
            return Some("（幻觉）");
        }
    }

    // Pass through everything else — let Whisper output speak for itself
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty() {
        assert_eq!(detect_noise(""), Some("（无声）"));
        assert_eq!(detect_noise("   "), Some("（无声）"));
    }

    #[test]
    fn test_short_noise() {
        assert_eq!(detect_noise("啊"), Some("（噪音）"));
        assert_eq!(detect_noise("嗯"), Some("（噪音）"));
        assert_eq!(detect_noise("哦"), Some("（噪音）"));
    }

    #[test]
    fn test_repeated() {
        assert_eq!(detect_noise("啊啊啊啊"), Some("（重复噪音）"));
    }

    #[test]
    fn test_valid_speech() {
        assert_eq!(detect_noise("今天天气真好"), None);
        assert_eq!(detect_noise("我们开始讨论第一个议题"), None);
        assert_eq!(detect_noise("Hello大家好"), None);
    }
}
