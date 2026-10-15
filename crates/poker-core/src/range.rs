//! Hand ranges: a weight from 0 to 1 for each of the 1,326 two-card combos.
//!
//! Notation is PokerStove-style, the format most poker tools share:
//!
//! | Token          | Meaning                                              |
//! |----------------|------------------------------------------------------|
//! | `QJs`, `KTo`   | one suited / offsuit hand class (4 / 12 combos)      |
//! | `AK`           | suited and offsuit together (16 combos)              |
//! | `TT`           | a pocket pair (6 combos)                             |
//! | `22+`          | that pair and every higher pair                      |
//! | `A2s+`, `KTo+` | raise the kicker up to one below the top card        |
//! | `AKs-ATs`      | the classes between two endpoints (either order)     |
//! | `TT-77`        | the pairs between two endpoints (either order)       |
//! | `AsKd`         | one specific combo                                   |
//! | `AKs:0.5`      | a token at a weight                                  |
//! | `0.5(AKs, QQ)` | a group at a weight; `50%(AKs, QQ)` also works       |
//!
//! Tokens are comma-separated. When two tokens cover the same combo, the later
//! one wins, so `AK, AKs:0.5` means offsuit AK fully and suited AK half the time.

use std::fmt;
use std::str::FromStr;

use crate::card::Card;
use crate::mask::CardMask;

/// Number of distinct two-card starting hands.
pub const COMBOS: usize = 1326;

const RANK_CHARS: &[u8; 13] = b"23456789TJQKA";

const fn build_combo_cards() -> [[u8; 2]; COMBOS] {
    let mut table = [[0u8; 2]; COMBOS];
    let mut hi = 1;
    while hi < 52 {
        let mut lo = 0;
        while lo < hi {
            table[hi * (hi - 1) / 2 + lo] = [lo as u8, hi as u8];
            lo += 1;
        }
        hi += 1;
    }
    table
}

/// `COMBO_CARDS[i]` = the two card indices of combo `i`, lower first.
static COMBO_CARDS: [[u8; 2]; COMBOS] = build_combo_cards();

/// Index (0–1325) of the combo made of two different cards, in either order.
///
/// Combos are numbered by their higher card `h` and lower card `l` as
/// `h·(h−1)/2 + l`: all combos with high card 1 come first (just one), then
/// high card 2 (two of them), and so on. That fills 0..1326 with no gaps.
pub fn combo_index(a: Card, b: Card) -> usize {
    let (lo, hi) = if a.index() < b.index() {
        (a.index() as usize, b.index() as usize)
    } else {
        (b.index() as usize, a.index() as usize)
    };
    assert!(lo != hi, "a combo needs two different cards");
    hi * (hi - 1) / 2 + lo
}

/// The two cards of combo `index`, lower card first.
pub fn combo_cards(index: usize) -> [Card; 2] {
    let [a, b] = COMBO_CARDS[index];
    [Card::from_index(a), Card::from_index(b)]
}

pub fn combo_mask(index: usize) -> CardMask {
    combo_cards(index).into_iter().collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RangeError {
    pub token: String,
    pub reason: String,
}

impl fmt::Display for RangeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "can't parse {:?}: {}", self.token, self.reason)
    }
}

impl std::error::Error for RangeError {}

fn error(token: &str, reason: impl Into<String>) -> RangeError {
    RangeError {
        token: token.to_string(),
        reason: reason.into(),
    }
}

#[derive(Clone, PartialEq)]
pub struct Range {
    weights: Vec<f32>,
}

impl fmt::Debug for Range {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Range({:?})", self.to_notation())
    }
}

impl Range {
    pub fn empty() -> Range {
        Range {
            weights: vec![0.0; COMBOS],
        }
    }

    /// Every combo at full weight ("any two cards").
    pub fn full() -> Range {
        Range {
            weights: vec![1.0; COMBOS],
        }
    }

    /// Builds a range from 1,326 weights (e.g. received from the UI).
    pub fn from_weights(weights: Vec<f32>) -> Result<Range, RangeError> {
        if weights.len() != COMBOS {
            return Err(error(
                "<weights>",
                format!("expected {COMBOS} weights, got {}", weights.len()),
            ));
        }
        if let Some(w) = weights.iter().find(|w| !(0.0..=1.0).contains(*w)) {
            return Err(error("<weights>", format!("weight {w} is outside 0-1")));
        }
        Ok(Range { weights })
    }

    pub fn parse(notation: &str) -> Result<Range, RangeError> {
        let mut range = Range::empty();
        for (token, weight) in weighted_tokens(notation)? {
            for combo in expand_token(token)? {
                range.weights[combo] = weight;
            }
        }
        Ok(range)
    }

    pub fn weights(&self) -> &[f32] {
        &self.weights
    }

    pub fn weight(&self, combo: usize) -> f32 {
        self.weights[combo]
    }

    pub fn set_weight(&mut self, combo: usize, weight: f32) {
        assert!(
            (0.0..=1.0).contains(&weight),
            "weight {weight} is outside 0-1"
        );
        self.weights[combo] = weight;
    }

    /// Combos with a nonzero weight, as (index, cards, weight).
    pub fn combos(&self) -> impl Iterator<Item = (usize, [Card; 2], f32)> + '_ {
        self.weights
            .iter()
            .enumerate()
            .filter(|&(_, &w)| w > 0.0)
            .map(|(i, &w)| (i, combo_cards(i), w))
    }

    /// Total weight: the number of combos, counting a half-weighted combo as half.
    pub fn combo_count(&self) -> f64 {
        self.weights.iter().map(|&w| w as f64).sum()
    }

    /// The same range with every combo that uses a `dead` card removed (blockers).
    pub fn without(&self, dead: CardMask) -> Range {
        let mut out = self.clone();
        for (i, w) in out.weights.iter_mut().enumerate() {
            if combo_mask(i).intersects(dead) {
                *w = 0.0;
            }
        }
        out
    }

    /// A stable fingerprint of the weights (FNV-1a over their bits), used as a cache key.
    pub fn fingerprint(&self) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for w in &self.weights {
            for byte in w.to_bits().to_le_bytes() {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        hash
    }

    /// Canonical, compact notation. `Range::parse` of the result gives back this range.
    pub fn to_notation(&self) -> String {
        print_notation(self)
    }
}

impl FromStr for Range {
    type Err = RangeError;

    fn from_str(s: &str) -> Result<Range, RangeError> {
        Range::parse(s)
    }
}

impl fmt::Display for Range {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_notation())
    }
}

// ---------- Parsing ----------

/// Splits notation into (token, weight) pairs, expanding `w(...)` groups and `token:w` suffixes.
fn weighted_tokens(s: &str) -> Result<Vec<(&str, f32)>, RangeError> {
    let mut out = Vec::new();
    for item in split_top_level(s)? {
        if let Some(open) = item.find('(') {
            let inner = item[open + 1..]
                .strip_suffix(')')
                .ok_or_else(|| error(item, "a weighted group must end with ')'"))?;
            let weight = parse_weight(item, item[..open].trim())?;
            for token in inner.split(',').map(str::trim).filter(|t| !t.is_empty()) {
                if token.contains(['(', ')', ':']) {
                    return Err(error(token, "weights can't be nested"));
                }
                out.push((token, weight));
            }
        } else if let Some((token, weight)) = item.split_once(':') {
            out.push((token.trim(), parse_weight(item, weight.trim())?));
        } else {
            out.push((item, 1.0));
        }
    }
    Ok(out)
}

/// Splits on commas that aren't inside parentheses, trimming and dropping empty items.
fn split_top_level(s: &str) -> Result<Vec<&str>, RangeError> {
    let mut items = Vec::new();
    let (mut depth, mut start) = (0i32, 0);
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                items.push(&s[start..i]);
                start = i + 1;
            }
            _ => {}
        }
        if !(0..=1).contains(&depth) {
            return Err(error(s, "unbalanced or nested parentheses"));
        }
    }
    if depth != 0 {
        return Err(error(s, "unclosed '('"));
    }
    items.push(&s[start..]);
    Ok(items
        .into_iter()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect())
}

/// `0.5` or `50%` → 0.5.
fn parse_weight(token: &str, w: &str) -> Result<f32, RangeError> {
    let value = match w.strip_suffix('%') {
        Some(percent) => percent.trim().parse::<f32>().map(|p| p / 100.0),
        None => w.parse::<f32>(),
    }
    .map_err(|_| error(token, format!("bad weight {w:?}")))?;
    if !(0.0..=1.0).contains(&value) {
        return Err(error(
            token,
            format!("weight {w} is outside 0-1 (or 0%-100%)"),
        ));
    }
    Ok(value)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Suitedness {
    Suited,
    Offsuit,
    Any,
}

/// A hand class like `AKs`, `T9o`, `QJ` or `77`. `high >= low`; a pair has `high == low`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Class {
    high: u8,
    low: u8,
    suited: Suitedness,
}

impl Class {
    fn is_pair(self) -> bool {
        self.high == self.low
    }

    fn combos(self) -> Vec<usize> {
        let mut out = Vec::new();
        for s1 in 0..4 {
            for s2 in 0..4 {
                let wanted = if self.is_pair() {
                    s1 < s2
                } else {
                    match self.suited {
                        Suitedness::Suited => s1 == s2,
                        Suitedness::Offsuit => s1 != s2,
                        Suitedness::Any => true,
                    }
                };
                if wanted {
                    out.push(combo_index(
                        Card::new(self.high, s1),
                        Card::new(self.low, s2),
                    ));
                }
            }
        }
        out
    }
}

fn rank_of(c: char) -> Option<u8> {
    RANK_CHARS
        .iter()
        .position(|&r| r as char == c.to_ascii_uppercase())
        .map(|r| r as u8)
}

/// Parses `AKs`, `KAo`, `QJ`, `77` (no `+` or `-`).
fn parse_class(token: &str, text: &str) -> Result<Class, RangeError> {
    let chars: Vec<char> = text.chars().collect();
    let (r1, r2, flag) = match chars.as_slice() {
        [a, b] => (*a, *b, None),
        [a, b, f] => (*a, *b, Some(f.to_ascii_lowercase())),
        _ => return Err(error(token, "expected a hand like AKs, KTo, QJ or 77")),
    };
    let (a, b) = match (rank_of(r1), rank_of(r2)) {
        (Some(a), Some(b)) => (a, b),
        _ => return Err(error(token, "unknown rank (use 2-9, T, J, Q, K, A)")),
    };
    let suited = match flag {
        None => Suitedness::Any,
        Some('s') => Suitedness::Suited,
        Some('o') => Suitedness::Offsuit,
        Some(f) => return Err(error(token, format!("unknown suffix {f:?} (use s or o)"))),
    };
    if a == b && suited != Suitedness::Any {
        return Err(error(token, "a pair can't be suited or offsuit"));
    }
    Ok(Class {
        high: a.max(b),
        low: a.min(b),
        suited,
    })
}

fn expand_token(token: &str) -> Result<Vec<usize>, RangeError> {
    let chars: Vec<char> = token.chars().collect();

    // A specific combo: rank, suit, rank, suit.
    if chars.len() == 4
        && "cdhs".contains(chars[1].to_ascii_lowercase())
        && "cdhs".contains(chars[3].to_ascii_lowercase())
    {
        let a: Card = token[..2].parse().map_err(|_| error(token, "bad card"))?;
        let b: Card = token[2..].parse().map_err(|_| error(token, "bad card"))?;
        if a == b {
            return Err(error(token, "a combo needs two different cards"));
        }
        return Ok(vec![combo_index(a, b)]);
    }

    let classes = if let Some((from, to)) = token.split_once('-') {
        let (from, to) = (
            parse_class(token, from.trim())?,
            parse_class(token, to.trim())?,
        );
        span(token, from, to)?
    } else if let Some(base) = token.strip_suffix('+') {
        let class = parse_class(token, base)?;
        if class.is_pair() {
            (class.high..13)
                .map(|r| Class {
                    high: r,
                    low: r,
                    ..class
                })
                .collect()
        } else {
            (class.low..class.high)
                .map(|k| Class { low: k, ..class })
                .collect()
        }
    } else {
        vec![parse_class(token, token)?]
    };

    Ok(classes.into_iter().flat_map(Class::combos).collect())
}

/// The classes from `a` to `b` inclusive: pairs `TT-77`, or kickers `AKs-ATs`.
fn span(token: &str, a: Class, b: Class) -> Result<Vec<Class>, RangeError> {
    if a.is_pair() && b.is_pair() {
        let (lo, hi) = (a.high.min(b.high), a.high.max(b.high));
        return Ok((lo..=hi)
            .map(|r| Class {
                high: r,
                low: r,
                ..a
            })
            .collect());
    }
    if a.is_pair() || b.is_pair() || a.high != b.high || a.suited != b.suited {
        return Err(error(
            token,
            "both ends must be pairs, or share the top card and suitedness",
        ));
    }
    let (lo, hi) = (a.low.min(b.low), a.low.max(b.low));
    Ok((lo..=hi).map(|k| Class { low: k, ..a }).collect())
}

// ---------- Printing ----------

fn rank_char(r: u8) -> char {
    RANK_CHARS[r as usize] as char
}

fn class_name(c: Class) -> String {
    let suffix = match (c.is_pair(), c.suited) {
        (true, _) | (false, Suitedness::Any) => "",
        (false, Suitedness::Suited) => "s",
        (false, Suitedness::Offsuit) => "o",
    };
    format!("{}{}{suffix}", rank_char(c.high), rank_char(c.low))
}

/// Groups of consecutive values (sorted ascending input) as (low, high) runs.
fn runs(values: &[u8]) -> Vec<(u8, u8)> {
    let mut out: Vec<(u8, u8)> = Vec::new();
    for &v in values {
        match out.last_mut() {
            Some((_, hi)) if *hi + 1 == v => *hi = v,
            _ => out.push((v, v)),
        }
    }
    out
}

fn print_notation(range: &Range) -> String {
    // Each class whose combos all share one weight prints as a class; the
    // rest print combo by combo.
    let mut class_weight: Vec<(Class, f32)> = Vec::new();
    let mut loose: Vec<(usize, f32)> = Vec::new();
    for high in (0..13u8).rev() {
        for low in (0..=high).rev() {
            let kinds: &[Suitedness] = if high == low {
                &[Suitedness::Any]
            } else {
                &[Suitedness::Suited, Suitedness::Offsuit]
            };
            for &suited in kinds {
                let class = Class { high, low, suited };
                let combos = class.combos();
                let first = range.weights[combos[0]];
                if combos.iter().all(|&c| range.weights[c] == first) {
                    if first > 0.0 {
                        class_weight.push((class, first));
                    }
                } else {
                    loose.extend(
                        combos
                            .iter()
                            .map(|&c| (c, range.weights[c]))
                            .filter(|&(_, w)| w > 0.0),
                    );
                }
            }
        }
    }

    // Distinct weights, full weight first, then descending.
    let mut weights: Vec<f32> = class_weight
        .iter()
        .map(|&(_, w)| w)
        .chain(loose.iter().map(|&(_, w)| w))
        .collect();
    weights.sort_by(|a, b| b.total_cmp(a));
    weights.dedup();

    let mut parts = Vec::new();
    for w in weights {
        let classes: Vec<Class> = class_weight
            .iter()
            .filter(|&&(_, cw)| cw == w)
            .map(|&(c, _)| c)
            .collect();
        let mut tokens = Vec::new();

        let pairs: Vec<u8> = classes
            .iter()
            .filter(|c| c.is_pair())
            .map(|c| c.high)
            .rev()
            .collect();
        for (lo, hi) in runs(&pairs).into_iter().rev() {
            let name = |r| {
                class_name(Class {
                    high: r,
                    low: r,
                    suited: Suitedness::Any,
                })
            };
            tokens.push(match (lo, hi) {
                _ if lo == hi => name(hi),
                (_, 12) => format!("{}+", name(lo)),
                _ => format!("{}-{}", name(hi), name(lo)),
            });
        }
        for suited in [Suitedness::Suited, Suitedness::Offsuit] {
            for high in (0..13u8).rev() {
                let kickers: Vec<u8> = classes
                    .iter()
                    .filter(|c| !c.is_pair() && c.high == high && c.suited == suited)
                    .map(|c| c.low)
                    .rev()
                    .collect();
                for (lo, hi) in runs(&kickers).into_iter().rev() {
                    let name = |k| {
                        class_name(Class {
                            high,
                            low: k,
                            suited,
                        })
                    };
                    tokens.push(match (lo, hi) {
                        _ if lo == hi => name(hi),
                        _ if hi + 1 == high => format!("{}+", name(lo)),
                        _ => format!("{}-{}", name(hi), name(lo)),
                    });
                }
            }
        }
        for &(combo, _) in loose.iter().filter(|&&(_, cw)| cw == w) {
            let [a, b] = combo_cards(combo);
            tokens.push(format!("{b}{a}")); // higher card first, e.g. AsKd
        }

        if tokens.is_empty() {
            continue;
        }
        let joined = tokens.join(", ");
        parts.push(if w == 1.0 {
            joined
        } else {
            format!("{w}({joined})")
        });
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(s: &str) -> Range {
        Range::parse(s).unwrap_or_else(|e| panic!("{e}"))
    }

    fn card(s: &str) -> Card {
        s.parse().unwrap()
    }

    #[test]
    fn combo_index_is_a_bijection() {
        let mut seen = [false; COMBOS];
        for a in Card::all() {
            for b in Card::all().filter(|b| b.index() > a.index()) {
                let i = combo_index(a, b);
                assert!(!seen[i]);
                seen[i] = true;
                assert_eq!(combo_cards(i), [a, b]);
                assert_eq!(combo_index(b, a), i);
            }
        }
        assert!(seen.iter().all(|&s| s));
    }

    #[test]
    fn known_combo_counts() {
        let cases = [
            ("AA", 6.0),
            ("AKs", 4.0),
            ("AKo", 12.0),
            ("AK", 16.0),
            ("22+", 78.0),
            ("A2s+", 48.0),
            ("KTo+", 36.0),
            ("QJs", 4.0),
            ("AKs-ATs", 16.0),
            ("ATs-AKs", 16.0),
            ("TT-77", 24.0),
            ("77-TT", 24.0),
            ("AsKd", 1.0),
            ("22+, A2s+, KTo+, QJs", 166.0),
            ("0.5(AA)", 3.0),
            ("AA:0.5", 3.0),
            ("50%(AA, KK)", 6.0),
        ];
        for (notation, expected) in cases {
            assert_eq!(r(notation).combo_count(), expected, "{notation}");
        }
        assert_eq!(Range::full().combo_count(), 1326.0);
    }

    #[test]
    fn parsing_is_forgiving_about_case_and_spacing() {
        assert_eq!(r("aks , kto+"), r("AKs,KTo+"));
        assert_eq!(r("KA"), r("AK"));
        assert_eq!(r(""), Range::empty());
    }

    #[test]
    fn later_tokens_override_earlier_ones() {
        let range = r("AK, AKs:0.5");
        let suited = combo_index(card("As"), card("Ks"));
        let offsuit = combo_index(card("As"), card("Kd"));
        assert_eq!(range.weight(suited), 0.5);
        assert_eq!(range.weight(offsuit), 1.0);
    }

    #[test]
    fn rejects_bad_notation() {
        for bad in [
            "AKx",
            "AAs",
            "A",
            "AKQ",
            "1A",
            "AA-KQs",
            "AKs-QJs",
            "AKs-AQo",
            "AsAs",
            "AK:1.5",
            "AK:abc",
            "0.5(AK",
            "0.5(AK, (QQ))",
            "150%(AA)",
            "0.5(AK:0.3)",
        ] {
            assert!(Range::parse(bad).is_err(), "{bad:?} should not parse");
        }
    }

    #[test]
    fn blockers_remove_combos() {
        // Holding the ace of spades on a king-high board: AA drops from 6 to 3, AK from 16 to 9.
        let dead: CardMask = [card("As"), card("Kh")].into_iter().collect();
        assert_eq!(r("AA").without(dead).combo_count(), 3.0);
        assert_eq!(r("AK").without(dead).combo_count(), 9.0);
    }

    #[test]
    fn prints_compact_canonical_notation() {
        let cases = [
            ("22+", "22+"),
            ("AA", "AA"),
            ("TT-77", "TT-77"),
            ("77, 88, 99, TT", "TT-77"),
            ("A2s+", "A2s+"),
            ("KTo+", "KTo+"),
            ("AKs-ATs", "ATs+"), // same hands; "+" is shorter
            ("KJs-K8s", "KJs-K8s"),
            ("AK", "AKs, AKo"),
            (
                "QQ+, 55-22, AJs+, KQs, T9s, 0.5(98s, 87s)",
                "QQ+, 55-22, AJs+, KQs, T9s, 0.5(98s, 87s)",
            ),
            ("AsKd", "AsKd"),
        ];
        for (input, expected) in cases {
            assert_eq!(r(input).to_notation(), expected, "{input}");
        }
    }

    #[test]
    fn printing_then_parsing_gives_back_the_same_range() {
        // Deterministic pseudo-random ranges mixing full, partial and per-combo weights.
        let mut state: u64 = 0x1234_5678;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        for _ in 0..500 {
            let mut range = Range::empty();
            for i in 0..COMBOS {
                let roll = next() % 100;
                let class_level = next() % 4;
                range.weights[i] = match roll {
                    0..60 => 0.0,
                    60..85 => 1.0,
                    _ => [0.25, 0.5, 0.75, 0.1][class_level as usize],
                };
            }
            // Also some whole-class weights, so class grouping gets exercised.
            let w = [0.0f32, 1.0, 0.5][(next() % 3) as usize];
            for c in r("22+, A2s+").combos().map(|(i, _, _)| i) {
                range.weights[c] = w;
            }
            let printed = range.to_notation();
            assert_eq!(r(&printed), range, "round trip failed via {printed:?}");
        }
    }

    #[test]
    fn from_weights_validates() {
        assert!(Range::from_weights(vec![0.5; COMBOS]).is_ok());
        assert!(Range::from_weights(vec![0.5; 10]).is_err());
        assert!(Range::from_weights(vec![1.5; COMBOS]).is_err());
    }

    #[test]
    fn fingerprint_changes_with_weights() {
        assert_eq!(r("AA, KK").fingerprint(), r("KK, AA").fingerprint());
        assert_ne!(r("AA").fingerprint(), r("KK").fingerprint());
        assert_ne!(r("AA").fingerprint(), r("0.5(AA)").fingerprint());
    }
}
