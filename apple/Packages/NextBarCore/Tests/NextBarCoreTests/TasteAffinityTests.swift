import Foundation
import Testing
@testable import NextBarCore

/// Ports `src/lib/tasteAffinity.test.ts`.
private func makeBar(id: String, tags: [VibeTag]) -> Bar {
    Bar(
        id: id, name: id, neighborhood: .eastVillage, address: "1 Main St",
        lat: 40.7, lng: -73.9, priceTier: 2, tags: tags, blurb: "A bar.",
        lastVerified: "2026-07-20T00:00:00.000Z"
    )
}

private func rated(_ barId: String, _ score: Double?) -> BarRating {
    BarRating(barId: barId, rating: .liked, ratedAt: "2026-08-01T00:00:00.000Z", score: score)
}

private let tolerance = 1e-9

@Suite("deriveLearnedTaste — the approved V8 evidence model")
struct DeriveLearnedTasteTests {
    @Test("maps 5.5 to neutral, 10.0 to +1 and 1.0 to -1 before shrinkage")
    func mapsScoresToWeights() {
        let t = deriveLearnedTaste(
            [rated("hi", 10), rated("mid", 5.5), rated("lo", 1)],
            [makeBar(id: "hi", tags: [.club]), makeBar(id: "mid", tags: [.dive]), makeBar(id: "lo", tags: [.rooftop])]
        )
        #expect(abs((t.affinity[.club] ?? .nan) - 1.0 / 6.0) < tolerance)
        #expect(abs((t.affinity[.dive] ?? .nan) - 0) < tolerance)
        #expect(abs((t.affinity[.rooftop] ?? .nan) - (-1.0 / 6.0)) < tolerance)
    }

    @Test("accumulates repeated observations of the same tag")
    func accumulatesRepeatedObservations() {
        let one = deriveLearnedTaste([rated("a", 10)], [makeBar(id: "a", tags: [.dive])])
        let three = deriveLearnedTaste(
            [rated("a", 10), rated("b", 10), rated("c", 10)],
            [makeBar(id: "a", tags: [.dive]), makeBar(id: "b", tags: [.dive]), makeBar(id: "c", tags: [.dive])]
        )
        #expect(abs((one.affinity[.dive] ?? .nan) - 1.0 / 6.0) < tolerance)
        #expect(abs((three.affinity[.dive] ?? .nan) - 3.0 / 8.0) < tolerance)
        #expect(three.affinity[.dive]! > one.affinity[.dive]!)
    }

    @Test("lets low scores cancel high ones — negative evidence is real evidence")
    func lowScoresCancelHighOnes() {
        let t = deriveLearnedTaste(
            [rated("a", 10), rated("b", 1)],
            [makeBar(id: "a", tags: [.dive]), makeBar(id: "b", tags: [.dive])]
        )
        #expect(abs((t.affinity[.dive] ?? .nan) - 0) < tolerance)
    }

    @Test("is not fooled by rating COUNT — one loved bar is not two hundred")
    func notFooledByRatingCount() {
        let t = deriveLearnedTaste(
            [rated("a", 6), rated("b", 6)],
            [makeBar(id: "a", tags: [.dive]), makeBar(id: "b", tags: [.dive])]
        )
        #expect(t.affinity[.dive]! < 0.3)
    }

    @Test("ignores unscored ratings rather than inventing a midpoint for them")
    func ignoresUnscoredRatings() {
        let t = deriveLearnedTaste(
            [rated("a", nil), rated("b", nil)],
            [makeBar(id: "a", tags: [.dive]), makeBar(id: "b", tags: [.dive])]
        )
        #expect(t.n == 0)
        #expect(t.affinity.isEmpty)
    }

    @Test("skips ratings for bars outside the supplied catalog")
    func skipsRatingsOutsideCatalog() {
        let t = deriveLearnedTaste([rated("ghost", 9)], [makeBar(id: "a", tags: [.dive])])
        #expect(t.n == 0)
    }

    @Test("grows confidence as c = N/(N+10)")
    func growsConfidence() {
        func c(_ n: Int) -> Double {
            deriveLearnedTaste(
                (0..<n).map { rated("b\($0)", 8) },
                (0..<n).map { makeBar(id: "b\($0)", tags: [.dive]) }
            ).confidence
        }
        #expect(c(0) == 0)
        #expect(abs(c(10) - 0.5) < tolerance)
        #expect(abs(c(30) - 0.75) < tolerance)
    }

    @Test("does not truncate evidence to the Settings top-five display cap")
    func doesNotTruncateEvidence() {
        let tags: [VibeTag] = [.dive, .club, .rooftop, .cocktail, .chill, .cheap, .dance]
        let t = deriveLearnedTaste([rated("a", 9)], [makeBar(id: "a", tags: tags)])
        #expect(t.affinity.count == tags.count)
    }
}

@Suite("learnedTasteScore")
struct LearnedTasteScoreTests {
    @Test("averages A(tag) rather than summing, so tag count is not a rank bonus")
    func averagesRatherThanSums() {
        let taste = deriveLearnedTaste([rated("seed", 10)], [makeBar(id: "seed", tags: [.dive])])
        let focused = learnedTasteScore(makeBar(id: "x", tags: [.dive]), taste)
        let diluted = learnedTasteScore(makeBar(id: "y", tags: [.dive, .club, .rooftop]), taste)
        #expect(focused > diluted)
    }

    @Test("is 0 for an untagged bar and for empty taste")
    func zeroForUntaggedOrEmptyTaste() {
        #expect(learnedTasteScore(makeBar(id: "x", tags: []), emptyTaste) == 0)
        #expect(learnedTasteScore(makeBar(id: "x", tags: [.dive]), emptyTaste) == 0)
    }
}

@Suite("deriveLearnedTaste — hostile persisted scores")
struct HostilePersistedScoresTests {
    @Test("clamps out-of-range finite scores into the 1.0-10.0 band")
    func clampsOutOfRangeScores() {
        let wild = deriveLearnedTaste([rated("a", 1e308)], [makeBar(id: "a", tags: [.dive])])
        let top = deriveLearnedTaste([rated("a", 10)], [makeBar(id: "a", tags: [.dive])])
        #expect(abs(wild.affinity[.dive]! - top.affinity[.dive]!) < tolerance)
    }

    @Test("never yields Infinity or NaN from extreme repeated scores")
    func neverYieldsInfinityOrNaN() {
        let t = deriveLearnedTaste(
            [rated("a", .greatestFiniteMagnitude), rated("b", -.greatestFiniteMagnitude), rated("c", 1e308)],
            [makeBar(id: "a", tags: [.dive]), makeBar(id: "b", tags: [.dive]), makeBar(id: "c", tags: [.dive])]
        )
        #expect(t.affinity[.dive]!.isFinite)
    }

    @Test("keeps every affinity inside [-1, 1] whatever the input")
    func keepsAffinityInsideUnitRange() {
        let t = deriveLearnedTaste(
            (0..<50).map { rated("b\($0)", $0 % 2 != 0 ? 1e12 : -1e12) },
            (0..<50).map { makeBar(id: "b\($0)", tags: [.dive]) }
        )
        for v in t.affinity.values {
            #expect(v >= -1)
            #expect(v <= 1)
        }
    }
}
