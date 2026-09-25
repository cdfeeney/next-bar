import Foundation
import Testing
@testable import NextBarCore

/// Ports `src/lib/matching.explicitVibe.test.ts` — the explicit-intent ranking
/// path: an APPLIED Tweak-the-vibe pick outweighs learned taste 80/20, instead
/// of being weighted (1 - c) as the cold-start quiz prior.
private let NOW = parseISODate("2026-05-15T12:00:00Z")!
private let FRESH = "2026-04-01"
private let ORIGIN = Coords(lat: 40.755, lng: -73.984) // Midtown centroid

private func makeBar(
    id: String = "bar-x", lat: Double = ORIGIN.lat, lng: Double = ORIGIN.lng,
    tags: [VibeTag] = [], lastVerified: String = FRESH
) -> Bar {
    Bar(
        id: id, name: "X", neighborhood: .midtown, address: "1 Main St",
        lat: lat, lng: lng, priceTier: 2, tags: tags, blurb: "A bar.", lastVerified: lastVerified
    )
}

/// ~69 miles per degree of latitude — same helper the cascade tests use.
private func atMiles(_ id: String, _ miles: Double, _ tags: [VibeTag]) -> Bar {
    makeBar(id: id, lat: ORIGIN.lat + miles / 69, lng: ORIGIN.lng, tags: tags)
}

/// The vibe the user picks in the tweak surface.
private let PICKED: VibeTag = .cocktail
/// The vibe their rating history is soaked in.
private let HISTORY: VibeTag = .dive

/// A user whose whole history is `n` perfect scores on dive bars.
private func diveHistoryTaste(_ n: Int) -> LearnedTaste {
    let rated = (0..<n).map { makeBar(id: "hist-\($0)", tags: [HISTORY]) }
    let ratings = rated.map { bar in
        BarRating(barId: bar.id, rating: .loved, ratedAt: "2026-05-01T00:00:00.000Z", score: 10)
    }
    return deriveLearnedTaste(ratings, rated)
}

private func quizProfile(_ tags: [VibeTag]) -> VibeProfile {
    VibeProfile(tags: tags, archetype: "test-archetype", preferredNeighborhoods: [])
}

/// The same tags, but APPLIED through the tweak surface.
private func tweakedProfile(_ tags: [VibeTag]) -> VibeProfile {
    var p = quizProfile(tags)
    p.isExplicitVibe = true
    return p
}

/// A cocktail bar and a dive bar, both an easy walk away.
private func twoBarPool() -> [Bar] {
    [atMiles("cocktail-bar", 0.5, [PICKED]), atMiles("dive-bar", 0.6, [HISTORY])]
}

private func rank(_ profile: VibeProfile, _ bars: [Bar], _ taste: LearnedTaste) -> [String] {
    matches(MatchesArgs(
        profile: profile, coords: ORIGIN, preferredNeighborhoods: [], maxMiles: nil,
        bars: bars, maxResults: 5, now: NOW, taste: taste
    )).map(\.id)
}

@Suite("matches() — inactive tweak")
struct InactiveTweakTests {
    @Test("ranks by the normal quiz-prior cascade when no tweak has been applied")
    func ranksByNormalQuizPriorCascade() {
        let taste = diveHistoryTaste(200)
        #expect(rank(quizProfile([PICKED]), twoBarPool(), taste) == ["dive-bar", "cocktail-bar"])
    }

    @Test("treats an explicitly false flag exactly like an absent one")
    func treatsExplicitlyFalseFlagLikeAbsent() {
        let taste = diveHistoryTaste(200)
        let pool = twoBarPool()
        var falseFlag = quizProfile([PICKED])
        falseFlag.isExplicitVibe = false
        #expect(rank(falseFlag, pool, taste) == rank(quizProfile([PICKED]), pool, taste))
    }
}

@Suite("matches() — active tweak")
struct ActiveTweakTests {
    @Test("puts the picked vibe ahead of the bar the history favours")
    func putsPickedVibeAhead() {
        let taste = diveHistoryTaste(20)
        #expect(rank(quizProfile([PICKED]), twoBarPool(), taste) == ["dive-bar", "cocktail-bar"])
        // D-C-41: the dive bar is not merely outranked now, it is 0/1 and so
        // INELIGIBLE. A one-bar page is the honest answer.
        #expect(rank(tweakedProfile([PICKED]), twoBarPool(), taste) == ["cocktail-bar"])
    }

    @Test("still wins at 200+ ratings, where the quiz prior is worth 4.8%")
    func stillWinsAtHighRatingCounts() {
        for n in [200, 500] {
            let taste = diveHistoryTaste(n)
            #expect(taste.confidence > 0.95)
            #expect(rank(tweakedProfile([PICKED]), twoBarPool(), taste) == ["cocktail-bar"])
        }
    }

    @Test("orders two MATCHING bars by the 80/20 blend, not by learned taste alone")
    func ordersTwoMatchingBarsByBlend() {
        let rated =
            (0..<20).map { makeBar(id: "wine-\($0)", tags: [.wine]) }
                + (0..<20).map { makeBar(id: "ck-\($0)", tags: [PICKED]) }
        let taste = deriveLearnedTaste(
            rated.map { bar in
                BarRating(
                    barId: bar.id,
                    rating: bar.tags[0] == .wine ? .loved : .pass,
                    ratedAt: "2026-05-01T00:00:00.000Z",
                    score: bar.tags[0] == .wine ? 10 : 1
                )
            },
            rated
        )
        #expect(abs(taste.affinity[PICKED]! - (-0.8)) < 1e-9)
        #expect(abs(taste.affinity[.wine]! - 0.8) < 1e-9)

        let sharp = atMiles("sharp", 0.5, [PICKED])
        let broad = atMiles("broad", 0.6, [PICKED, .wine])

        let ids = matches(MatchesArgs(
            profile: tweakedProfile([PICKED]), coords: ORIGIN, preferredNeighborhoods: [],
            maxMiles: radiusWalk, bars: [broad, sharp], maxResults: 5, now: NOW, taste: taste
        )).map(\.id)
        #expect(ids == ["sharp", "broad"])
    }

    @Test("lets learned taste order bars that match the pick equally well")
    func letsLearnedTasteOrderEquallyMatchingBars() {
        let taste = diveHistoryTaste(200)
        let pool = [
            atMiles("cocktail-wine", 0.5, [PICKED, .wine]),
            atMiles("cocktail-dive", 0.6, [PICKED, HISTORY]),
        ]
        #expect(rank(tweakedProfile([PICKED]), pool, taste).first == "cocktail-dive")
    }
}

@Suite("matches() — distance band expansion under an active tweak")
struct DistanceBandExpansionUnderActiveTweakTests {
    private let walkables = [0.2, 0.4, 0.6, 0.8, 1.0].enumerated().map { atMiles("near-\($0.offset)", $0.element, [HISTORY]) }
    private let farMatch = atMiles("far-cocktail", 3.0, [PICKED]) // cab band

    private var pool: [Bar] { walkables + [farMatch] }

    @Test("without a tweak, the walkable band fills the page and the far bar never surfaces")
    func walkableBandFillsPageWithoutTweak() {
        #expect(!rank(quizProfile([PICKED]), pool, emptyTaste).contains("far-cocktail"))
    }

    @Test("reaches the far MATCH, and never pads the page with the near nonmatches")
    func reachesFarMatchWithoutPadding() {
        let ids = rank(tweakedProfile([PICKED]), pool, emptyTaste)
        #expect(ids == ["far-cocktail"])
    }

    @Test("does not expand an explicit maximum for an applied vibe")
    func doesNotExpandExplicitMaximum() {
        let ids = matches(MatchesArgs(
            profile: tweakedProfile([PICKED]), coords: ORIGIN, preferredNeighborhoods: [],
            minMilesExclusive: nil, maxMiles: radiusWalk, bars: pool, maxResults: 5, now: NOW, taste: emptyTaste
        )).map(\.id)
        #expect(ids == [])
    }

    @Test("reaches the NEXT band only — a match past RADIUS_CAB stays out of a Walkable page")
    func reachesNextBandOnly() {
        let scoped = [
            atMiles("walk-dive", 0.9, [HISTORY]),
            atMiles("cab-cocktail", 3.0, [PICKED]), // next band — reachable
            atMiles("far-cocktail", 9.0, [PICKED]), // two bands out — not
        ]
        let ids = matches(MatchesArgs(
            profile: tweakedProfile([PICKED]), coords: ORIGIN, preferredNeighborhoods: [],
            minMilesExclusive: nil, maxMiles: radiusWalk, bars: scoped, maxResults: 5, now: NOW, taste: emptyTaste
        )).map(\.id)
        #expect(ids == [])
    }

    @Test("enforces both geographic bounds even when no vibe match remains")
    func enforcesBothGeographicBounds() {
        let cabScoped = [
            atMiles("walk-cocktail", 0.5, [PICKED]), // inside the chip's inner edge
            atMiles("cab-dive", 2.0, [HISTORY]),
            atMiles("beyond-cocktail", 6.0, [PICKED]), // past its outer edge
        ]
        let ids = matches(MatchesArgs(
            profile: tweakedProfile([PICKED]), coords: ORIGIN, preferredNeighborhoods: [],
            minMilesExclusive: radiusWalk, maxMiles: radiusCab, bars: cabScoped, maxResults: 5, now: NOW, taste: emptyTaste
        )).map(\.id)
        #expect(ids == [])
    }

    @Test("changes geographic scope only — the radius never re-weights the vibe")
    func changesGeographicScopeOnly() {
        let scoped = [
            atMiles("walk-dive", 0.9, [HISTORY]),
            atMiles("walk-cocktail", 0.5, [PICKED]),
            atMiles("cab-cocktail", 3.0, [PICKED]),
            atMiles("cab-dive", 3.1, [HISTORY]),
        ]
        let anywhere = matches(MatchesArgs(
            profile: tweakedProfile([PICKED]), coords: ORIGIN, preferredNeighborhoods: [],
            maxMiles: nil, bars: scoped, maxResults: 5, now: NOW
        )).map(\.id)
        let walkOnly = matches(MatchesArgs(
            profile: tweakedProfile([PICKED]), coords: ORIGIN, preferredNeighborhoods: [],
            maxMiles: radiusWalk, bars: scoped, maxResults: 5, now: NOW
        )).map(\.id)
        #expect(anywhere == ["walk-cocktail", "cab-cocktail"])
        #expect(walkOnly == ["walk-cocktail"])
    }
}

@Suite("matches() — eligibility gates the pool (D-C-41)")
struct EligibilityGatesThePoolTests {
    private static let FOUR: [VibeTag] = [.cocktail, .wine, .jazz, .rooftop]

    /// A bar carrying the first `hit` of FOUR, padded with a non-picked tag.
    private static func hitting(_ id: String, _ hit: Int, _ miles: Double) -> Bar {
        atMiles(id, miles, Array(FOUR.prefix(hit)) + [.pub])
    }

    private static func rankFour(_ bars: [Bar], _ maxMiles: Double? = nil) -> [String] {
        matches(MatchesArgs(
            profile: tweakedProfile(FOUR), coords: ORIGIN, preferredNeighborhoods: [],
            minMilesExclusive: nil, maxMiles: maxMiles, bars: bars, maxResults: 10, now: NOW, taste: emptyTaste
        )).map(\.id)
    }

    @Test("admits 3/4 and 4/4 but not 2/4 — one miss is forgiven, two are not")
    func admits3And4NotForgiven2() {
        let ids = Self.rankFour([
            Self.hitting("four", 4, 0.4),
            Self.hitting("three", 3, 0.5),
            Self.hitting("two", 2, 0.6),
            Self.hitting("one", 1, 0.7),
            Self.hitting("zero", 0, 0.8),
        ])
        #expect(ids == ["four", "three"])
    }

    @Test("returns an EMPTY list rather than padding with rejected bars")
    func returnsEmptyListRatherThanPadding() {
        let ids = Self.rankFour([0.2, 0.3, 0.4, 0.5, 0.6].enumerated().map { Self.hitting("near-\($0.offset)", 1, $0.element) })
        #expect(ids == [])
    }

    @Test("an ineligible bar cannot re-enter through the band expansion")
    func ineligibleBarCannotReenterThroughExpansion() {
        let ids = Self.rankFour(
            [Self.hitting("near-two", 2, 0.5), Self.hitting("far-three", 3, 3.0)],
            radiusWalk
        )
        #expect(ids == [])
    }

    @Test("an ineligible bar cannot re-enter to fill an under-full page")
    func ineligibleBarCannotReenterToFillUnderFullPage() {
        let ids = Self.rankFour(
            [Self.hitting("eligible", 4, 0.4)]
                + (0..<9).map { Self.hitting("filler-\($0)", 1, 0.5 + Double($0) / 100) }
        )
        #expect(ids == ["eligible"])
    }

    @Test("deduplicates the selection before setting the threshold")
    func deduplicatesSelectionBeforeThreshold() {
        let oneOfTwo = atMiles("one-of-two", 0.5, [.cocktail, .pub])
        let ids = matches(MatchesArgs(
            profile: tweakedProfile([.cocktail, .cocktail, .wine, .wine]), coords: ORIGIN,
            preferredNeighborhoods: [], maxMiles: nil, bars: [oneOfTwo], maxResults: 5, now: NOW, taste: emptyTaste
        )).map(\.id)
        #expect(ids == ["one-of-two"])
    }
}

@Suite("matches() — clearing the tweak")
struct ClearingTheTweakTests {
    @Test("restores normal ranking exactly when the pick is emptied")
    func restoresNormalRankingWhenEmptied() {
        let taste = diveHistoryTaste(200)
        let pool = twoBarPool()
        let normal = rank(quizProfile([]), pool, taste)
        #expect(rank(tweakedProfile([]), pool, taste) == normal)
    }

    @Test("restores normal ranking when the flag is dropped again")
    func restoresNormalRankingWhenFlagDropped() {
        let taste = diveHistoryTaste(200)
        let pool = twoBarPool()
        #expect(rank(tweakedProfile([PICKED]), pool, taste) == ["cocktail-bar"])
        #expect(rank(quizProfile([PICKED]), pool, taste) == ["dive-bar", "cocktail-bar"])
    }
}

@Suite("explicitVibeScore")
struct ExplicitVibeScoreTests {
    private let taste = diveHistoryTaste(200)

    @Test("weights the picked vibe 80% and learned taste 20%")
    func weightsPickedVibe80PercentLearnedTaste20Percent() {
        let dive = makeBar(id: "d", tags: [HISTORY])
        #expect(abs(explicitVibeScore(dive, vibeTags: [PICKED], taste: taste) - 0.2 * learnedTasteScore(dive, taste)) < 1e-9)
        let cocktail = makeBar(id: "c", tags: [PICKED])
        #expect(abs(explicitVibeScore(cocktail, vibeTags: [PICKED], taste: taste) - 0.8) < 1e-9)
    }

    @Test("is independent of confidence — the blend never shrinks with N")
    func independentOfConfidence() {
        let cocktail = makeBar(id: "c", tags: [PICKED])
        let cold = explicitVibeScore(cocktail, vibeTags: [PICKED], taste: emptyTaste)
        let seasoned = explicitVibeScore(cocktail, vibeTags: [PICKED], taste: diveHistoryTaste(500))
        #expect(abs(cold - seasoned) < 1e-9)
    }
}
