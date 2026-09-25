import Foundation

/// Ports `src/lib/tasteAffinity.ts` — learned taste from numeric scores (V8 P1
/// ranking contract). The approved model, verbatim from docs/V8-PRD-2026-08-13.md:
///
///   w = (score - 5.5) / 4.5
///   A(tag) = sum(w) / (tag observation count + 5)
///   c = N / (N + 10)
///
/// These constants are explicit product assumptions; do not change them
/// silently.

/// The approved score range. Out-of-range persisted values are clamped here.
private let scoreMin: Double = 1
private let scoreMax: Double = 10

/// w = 0 here; the ends of the 1.0-10.0 range map to w = -1 and w = +1.
private let scoreMidpoint: Double = 5.5
private let scoreHalfRange: Double = 4.5

/// Per-tag shrinkage: one observation must not swing the rank like twenty.
private let tagShrinkage: Double = 5

/// Cold-start shrinkage: quiz taste dominates while rating history is small.
private let confidenceShrinkage: Double = 10

public struct LearnedTaste: Sendable {
    /// A(tag) for every tag the user has scored evidence on.
    public let affinity: [VibeTag: Double]
    /// N — scored ratings that landed on a catalog bar.
    public let n: Int
    /// c = N/(N+10) — how far learned taste outweighs the quiz prior.
    public let confidence: Double
}

public let emptyTaste = LearnedTaste(affinity: [:], n: 0, confidence: 0)

/// Pure: ratings + catalog -> per-tag affinity. Only ratings carrying a
/// numeric score are evidence; a `nil` score is not treated as neutral, it is
/// simply absent. Ratings on bars outside the supplied catalog are skipped.
///
/// NOT capped to the Settings top-five display tags — that cap is a
/// presentation choice elsewhere and must not truncate ranker evidence.
public func deriveLearnedTaste(_ ratings: [BarRating], _ bars: [Bar]) -> LearnedTaste {
    var barById: [String: Bar] = [:]
    for bar in bars { barById[bar.id] = bar }

    var sumW: [VibeTag: Double] = [:]
    var obs: [VibeTag: Int] = [:]
    var n = 0

    for rating in ratings {
        guard let rawScore = rating.score, rawScore.isFinite else { continue }
        guard let bar = barById[rating.barId] else { continue }

        n += 1
        // Clamp at the trust boundary — persisted ratings are not
        // score-validated and a tampered/legacy row can carry any finite
        // number. Unclamped, repeated extreme values overflow to infinity or
        // NaN, which would silently defeat the ranking comparator.
        let score = min(scoreMax, max(scoreMin, rawScore))
        let w = (score - scoreMidpoint) / scoreHalfRange
        for tag in bar.tags {
            sumW[tag, default: 0] += w
            obs[tag, default: 0] += 1
        }
    }

    var affinity: [VibeTag: Double] = [:]
    for (tag, total) in sumW {
        affinity[tag] = total / (Double(obs[tag] ?? 0) + tagShrinkage)
    }

    return LearnedTaste(
        affinity: affinity,
        n: n,
        confidence: Double(n) / (Double(n) + confidenceShrinkage)
    )
}

/// A bar's learned-taste value: the MEAN of A(tag) over its tags (not the
/// sum — summing would rank a bar higher for merely carrying more tags).
public func learnedTasteScore(_ bar: Bar, _ taste: LearnedTaste) -> Double {
    if bar.tags.isEmpty { return 0 }
    var total: Double = 0
    for tag in bar.tags { total += taste.affinity[tag] ?? 0 }
    return total / Double(bar.tags.count)
}
