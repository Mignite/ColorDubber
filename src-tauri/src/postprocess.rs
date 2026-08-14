#[derive(Clone)]
struct Tok {
    word: String,
    punc: String,
    start: f64,
    end: f64,
    leading_space: bool,
    segment_break: bool,
}

/// Public input word type (matches what whisper produces)
#[derive(Clone)]
pub struct WordInput {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub segment_break: bool,
}

/// Public output segment type  
#[derive(Clone)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[inline]
fn round3(x: f64) -> f64 { (x * 1000.0).round() / 1000.0 }

fn is_terminal_punct(p: &str) -> bool {
    p.chars().any(|c| matches!(c, '.' | '!' | '?' | '…' | '。' | '！' | '？' | '؟'))
}

fn is_comma_like(p: &str) -> bool {
    p.chars().any(|c| matches!(c, ',' | '，' | '、' | ';' | '؛'))
}

fn split_trailing_punct(s: &str) -> (String, String) {
    let is_punc = |c: char| matches!(c,
        '.' | '!' | '?' | ',' | ';' | ':' | '…' | '。' | '！' | '？' | '、' | '，' |
        '،' | '؛' | '؟' | '—' | '–' | ')' | ']' | '}' | '"' | '\u{201d}' | '\u{2019}' | '\u{bb}'
    );
    let cut = s.char_indices().rev()
        .take_while(|&(_, c)| is_punc(c))
        .last()
        .map(|(idx, _)| idx)
        .unwrap_or(s.len());
    if cut < s.len() {
        (s[..cut].to_string(), s[cut..].to_string())
    } else {
        (s.to_string(), String::new())
    }
}

fn is_letter_word(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphabetic() || c == '\'' || c == '\u{2019}')
}

fn merge_continuations(toks: &mut Vec<Tok>) {
    if toks.is_empty() { return; }
    let mut out: Vec<Tok> = Vec::with_capacity(toks.len());
    for t in std::mem::take(toks).into_iter() {
        if let Some(prev) = out.last_mut() {
            if t.segment_break {
                out.push(t);
                continue;
            }
            if t.word.is_empty() && !t.punc.is_empty() {
                prev.punc.push_str(&t.punc);
                prev.end = prev.end.max(t.end);
                continue;
            }
            let right_cont = !t.leading_space;
            let both_letter_word = is_letter_word(&prev.word) && is_letter_word(&t.word);
            let no_prev_punc = prev.punc.is_empty();
            if both_letter_word && no_prev_punc && right_cont {
                prev.word.push_str(&t.word);
                prev.punc.push_str(&t.punc);
                prev.end = prev.end.max(t.end);
                continue;
            }
        }
        out.push(t);
    }
    *toks = out;
}

fn render_slice(slice: &[Tok]) -> String {
    let mut s = String::new();
    for (i, t) in slice.iter().enumerate() {
        if t.leading_space && i > 0 { s.push(' '); }
        s.push_str(&t.word);
        s.push_str(&t.punc);
    }
    s
}

fn slice_chars(slice: &[Tok]) -> usize {
    let core: usize = slice.iter().map(|t| {
        unicode_segmentation::UnicodeSegmentation::graphemes(t.word.as_str(), true).count()
            + unicode_segmentation::UnicodeSegmentation::graphemes(t.punc.as_str(), true).count()
    }).sum();
    let spaces = slice.iter().skip(1).filter(|t| t.leading_space).count();
    core + spaces
}

fn choose_line_break(tokens: &[Tok], cap: usize) -> usize {
    let mut candidates = Vec::new();
    for index in 1..tokens.len() {
        if !tokens[index].leading_space { continue; }
        let left_len = slice_chars(&tokens[..index]);
        if left_len > cap { continue; }
        candidates.push((index, left_len, break_priority(tokens, index)));
    }
    let total_len = slice_chars(tokens);
    let line_count = total_len.div_ceil(cap).max(1);
    let target = total_len.div_ceil(line_count);
    let tolerance = cap / 3;
    candidates.iter()
        .filter(|(_, len, priority)| *priority > 0 && len.abs_diff(target) <= tolerance)
        .max_by_key(|(_, len, priority)| (*priority, usize::MAX - len.abs_diff(target)))
        .or_else(|| candidates.iter().min_by_key(|(_, len, _)| len.abs_diff(target)))
        .map(|(idx, _, _)| *idx)
        .unwrap_or(1)
}

fn break_priority(tokens: &[Tok], index: usize) -> u8 {
    let left = &tokens[index - 1];
    let right = &tokens[index];
    if is_terminal_punct(&left.punc) { 3 }
    else if is_comma_like(&left.punc) || right.start - left.end >= 0.25 { 2 }
    else { 0 }
}

fn wrap_group(remaining: Vec<Tok>, cap: usize) -> Vec<Vec<Tok>> {
    let cap = cap.max(1);
    let mut lines = Vec::new();
    let mut rem = remaining;
    while slice_chars(&rem) > cap && rem.len() > 1 {
        let split = choose_line_break(&rem, cap);
        if split == 0 || split >= rem.len() { break; }
        let carry = rem.split_off(split);
        lines.push(rem);
        rem = carry;
    }
    if !rem.is_empty() { lines.push(rem); }
    lines
}

pub struct PostProcessConfig {
    pub max_chars_per_line: usize,
    pub max_lines: usize,
    pub split_gap_sec: f64,
    pub min_sub_dur: f64,
    pub max_sub_dur: f64,
}

impl Default for PostProcessConfig {
    fn default() -> Self {
        Self {
            max_chars_per_line: 42,
            max_lines: 2,
            split_gap_sec: 0.5,
            min_sub_dur: 1.0,
            max_sub_dur: 6.0,
        }
    }
}

pub fn process_segments(words: Vec<WordInput>, cfg: &PostProcessConfig) -> Vec<Cue> {
    // 1. Separate trailing punctuation, preserve leading_space
    let mut toks: Vec<Tok> = Vec::with_capacity(words.len());
    for w in words {
        let (core_raw, punc_raw) = split_trailing_punct(&w.text);
        let leading_space = core_raw.starts_with(' ') || core_raw.starts_with('\n');
        let core = core_raw.trim_start_matches(|c| c == ' ' || c == '\n').replace('\u{FFFD}', "");
        let punc = punc_raw.replace('\u{FFFD}', "");
        if core.is_empty() && punc.is_empty() { continue; }
        toks.push(Tok { word: core, punc, start: w.start, end: w.end, leading_space, segment_break: w.segment_break });
    }

    // 2. Merge BPE continuations
    merge_continuations(&mut toks);

    // 3. Merge standalone punctuation into previous word
    let mut j = toks.len();
    while j > 1 {
        j -= 1;
        let es_punt = {
            let t = &toks[j];
            let full = format!("{}{}", t.word, t.punc);
            !full.is_empty() && full.chars().all(|c| matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | '…' | '+'))
        };
        if es_punt {
            let punc_word = toks.remove(j);
            let prev = &mut toks[j - 1];
            if !punc_word.word.is_empty() { prev.punc.push_str(&punc_word.word); }
            if !punc_word.punc.is_empty() { prev.punc.push_str(&punc_word.punc); }
        }
    }

    // 4. Sort chronologically
    toks.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));

    // 5. Split into cue groups at hard boundaries
    let groups = split_into_cue_groups(toks, cfg);

    // 6. Wrap each group and build cues
    let mut cues = Vec::new();
    for group in groups {
        let lines = wrap_group(group, cfg.max_chars_per_line);
        let max_lines = cfg.max_lines.max(1);
        for cue_lines in lines.chunks(max_lines) {
            cues.push(segment_from_lines(cue_lines));
        }
    }

    // 7. Schedule minimum duration
    schedule_min_duration(&mut cues, cfg.min_sub_dur);

    cues
}

fn split_into_cue_groups(toks: Vec<Tok>, cfg: &PostProcessConfig) -> Vec<Vec<Tok>> {
    let mut groups = Vec::new();
    let mut current: Vec<Tok> = Vec::new();
    for tok in toks {
        if let Some(previous) = current.last() {
            let long_pause = tok.start - previous.end >= cfg.split_gap_sec;
            let exceeds_max = cfg.max_sub_dur > 0.0 && tok.end - current[0].start > cfg.max_sub_dur;
            if tok.segment_break || long_pause || exceeds_max {
                groups.push(std::mem::take(&mut current));
            }
        }
        let ends_sentence = is_terminal_punct(&tok.punc);
        current.push(tok);
        if ends_sentence {
            groups.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() { groups.push(current); }
    groups
}

fn segment_from_lines(lines: &[Vec<Tok>]) -> Cue {
    let tokens: Vec<&Tok> = lines.iter().flat_map(|line| line.iter()).collect();
    let start = tokens.first().map(|t| t.start).unwrap_or(0.0);
    let end = tokens.last().map(|t| t.end).unwrap_or(start);
    let text = lines.iter()
        .map(|line| render_slice(line))
        .collect::<Vec<_>>()
        .join("\n");
    Cue { start: round3(start), end: round3(end), text }
}

fn schedule_min_duration(cues: &mut [Cue], min_dur: f64) {
    let min_dur = min_dur.max(0.0);
    for i in 0..cues.len() {
        let next_start = cues.get(i + 1).map(|c| c.start).unwrap_or(f64::MAX);
        let desired = cues[i].end.max(cues[i].start + min_dur);
        cues[i].end = round3(desired.min(next_start).max(cues[i].start));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_trailing_punct_basic() {
        let (word, punct) = split_trailing_punct("hello.");
        assert_eq!(word, "hello");
        assert_eq!(punct, ".");
    }

    #[test]
    fn test_split_trailing_punct_no_punct() {
        let (word, punct) = split_trailing_punct("hello");
        assert_eq!(word, "hello");
        assert_eq!(punct, "");
    }

    #[test]
    fn test_split_trailing_punct_multiple() {
        let (word, punct) = split_trailing_punct("hello...");
        assert_eq!(word, "hello");
        assert_eq!(punct, "...");
    }

    #[test]
    fn test_split_trailing_punct_mixed() {
        let (word, punct) = split_trailing_punct("hello!?");
        assert_eq!(word, "hello");
        assert_eq!(punct, "!?");
    }

    #[test]
    fn test_is_terminal_punct_true() {
        assert!(is_terminal_punct("."));
        assert!(is_terminal_punct("!"));
        assert!(is_terminal_punct("?"));
        assert!(is_terminal_punct("…"));
    }

    #[test]
    fn test_is_terminal_punct_false() {
        assert!(!is_terminal_punct(","));
        assert!(!is_terminal_punct(" "));
        assert!(!is_terminal_punct("a"));
    }

    #[test]
    fn test_is_comma_like_true() {
        assert!(is_comma_like(","));
        assert!(is_comma_like(";"));
    }

    #[test]
    fn test_is_comma_like_false() {
        assert!(!is_comma_like("."));
        assert!(!is_comma_like("!"));
    }

    #[test]
    fn test_merge_continuations_empty() {
        let mut toks: Vec<Tok> = vec![];
        merge_continuations(&mut toks);
        assert!(toks.is_empty());
    }

    #[test]
    fn test_merge_continuations_no_merge() {
        let toks = vec![
            Tok { word: "hello".into(), punc: "".into(), start: 0.0, end: 0.5, leading_space: false, segment_break: false },
            Tok { word: "world".into(), punc: "".into(), start: 0.6, end: 1.0, leading_space: true, segment_break: false },
        ];
        let mut result = toks.clone();
        merge_continuations(&mut result);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_round3() {
        assert!((round3(1.23456) - 1.235).abs() < 1e-10);
        assert!((round3(1.0) - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_render_slice_single() {
        let toks = vec![
            Tok { word: "hello".into(), punc: ".".into(), start: 0.0, end: 0.5, leading_space: false, segment_break: false },
        ];
        assert_eq!(render_slice(&toks), "hello.");
    }

    #[test]
    fn test_render_slice_with_space() {
        let toks = vec![
            Tok { word: "hello".into(), punc: "".into(), start: 0.0, end: 0.5, leading_space: false, segment_break: false },
            Tok { word: "world".into(), punc: "".into(), start: 0.6, end: 1.0, leading_space: true, segment_break: false },
        ];
        assert_eq!(render_slice(&toks), "hello world");
    }

    #[test]
    fn test_process_segments_basic() {
        let words = vec![
            WordInput { text: " Hello".into(), start: 0.0, end: 0.3, segment_break: false },
            WordInput { text: " world".into(), start: 0.35, end: 0.6, segment_break: false },
            WordInput { text: " foo".into(), start: 0.65, end: 0.9, segment_break: false },
        ];
        let cfg = PostProcessConfig { max_chars_per_line: 42, max_lines: 2, split_gap_sec: 0.5, min_sub_dur: 0.5, max_sub_dur: 6.0 };
        let cues = process_segments(words, &cfg);
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text, "Hello world foo");
    }

    #[test]
    fn test_process_segments_split_by_gap() {
        let words = vec![
            WordInput { text: " Hello".into(), start: 0.0, end: 0.3, segment_break: false },
            WordInput { text: " world".into(), start: 0.35, end: 0.6, segment_break: false },
            WordInput { text: " later".into(), start: 2.0, end: 2.5, segment_break: false },
        ];
        let cfg = PostProcessConfig { max_chars_per_line: 42, max_lines: 2, split_gap_sec: 0.5, min_sub_dur: 0.5, max_sub_dur: 6.0 };
        let cues = process_segments(words, &cfg);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text, "Hello world");
        assert_eq!(cues[1].text, "later");
    }

    #[test]
    fn test_process_segments_line_wrapping() {
        let words: Vec<WordInput> = (0..10).map(|i| WordInput {
            text: format!(" word{}", i),
            start: i as f64 * 0.3,
            end: i as f64 * 0.3 + 0.25,
            segment_break: false,
        }).collect();
        let cfg = PostProcessConfig { max_chars_per_line: 10, max_lines: 2, split_gap_sec: 0.5, min_sub_dur: 0.5, max_sub_dur: 6.0 };
        let cues = process_segments(words, &cfg);
        assert!(cues.len() >= 2);
        for cue in &cues {
            assert!(cue.end > cue.start);
        }
    }

    #[test]
    fn test_schedule_min_duration() {
        let mut cues = vec![Cue { start: 0.0, end: 0.3, text: "hi".into() }];
        schedule_min_duration(&mut cues, 1.0);
        assert!((cues[0].end - 1.0).abs() < 1e-3);
    }
}
