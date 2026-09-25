import Foundation
import Testing
@testable import NextBarCore

/// Ports `src/lib/matching.test.ts`.
private let NOW = isoDate("2026-05-15T12:00:00Z")
private let FRESH = "2026-04-01" // ~44 days old — passes the hard-filter window
private let STALE = "2025-01-01" // ~500 days old — fails the 365-day filter

private func isoDate(_ s: String) -> Date { parseISODate(s)! }

private func makeBar(
    id: String = "bar-x",
    neighborhood: Neighborhood = .midtown,
    lat: Double = 40.7550,
    lng: Double = -73.9840,
    tags: [VibeTag] = [],
    lastVerified: String = FRESH,
    businessStatus: BusinessStatus? = nil
) -> Bar {
    Bar(
        id: id, name: "X", neighborhood: neighborhood, address: "1 Main St",
        lat: lat, lng: lng, priceTier: 2, tags: tags, blurb: "A bar.",
        lastVerified: lastVerified, businessStatus: businessStatus
    )
}

private func baseProfile(_ tags: [VibeTag]) -> VibeProfile {
    VibeProfile(tags: tags, archetype: "test-archetype", preferredNeighborhoods: [])
}

@Suite("jaccard")
struct JaccardTests {
    @Test("returns 0 when sets have empty intersection")
    func emptyIntersection() {
        #expect(jaccard([.dive, .beer], [.cocktail, .wine]) == 0)
    }

    @Test("returns 1 for identical sets")
    func identicalSets() {
        #expect(jaccard([.dive, .beer], [.dive, .beer]) == 1)
    }

    @Test("is commutative")
    func isCommutative() {
        let a: [VibeTag] = [.cocktail, .speakeasy, .polished]
        let b: [VibeTag] = [.cocktail, .dive, .cheap]
        #expect(jaccard(a, b) == jaccard(b, a))
    }

    @Test("returns 0 when both inputs are empty (no divide-by-zero)")
    func bothEmpty() {
        #expect(jaccard([], []) == 0)
    }
}

@Suite("selectedVibes")
struct SelectedVibesTests {
    @Test("returns null for a saved quiz profile — a prior is not a selection")
    func nullForSavedQuizProfile() {
        #expect(selectedVibes(baseProfile([.jazz, .live])) == nil)
    }

    @Test("returns null when the flag is explicitly false")
    func nullWhenFlagFalse() {
        var p = baseProfile([.jazz])
        p.isExplicitVibe = false
        #expect(selectedVibes(p) == nil)
    }

    @Test("returns null for a CLEARED pick — the flag with no tags")
    func nullForClearedPick() {
        var p = baseProfile([])
        p.isExplicitVibe = true
        #expect(selectedVibes(p) == nil)
    }

    @Test("deduplicates, so a repeated pick counts once")
    func deduplicates() {
        var p = baseProfile([.cocktail, .cocktail, .wine])
        p.isExplicitVibe = true
        #expect(selectedVibes(p) == [.cocktail, .wine])
    }
}

@Suite("vibeMatchBadge")
struct VibeMatchBadgeTests {
    @Test("is null with no selection — there is no honest fraction to show")
    func nullWithNoSelection() {
        #expect(vibeMatchBadge([], [.cocktail, .dive]) == nil)
        #expect(vibeMatchBadge([], []) == nil)
    }

    @Test("numerator is the intersection with the SELECTED vibes")
    func numeratorIsIntersection() {
        #expect(
            vibeMatchBadge([.cocktail, .speakeasy, .polished], [.cocktail, .speakeasy, .dive])
                == VibeMatchBadge(num: 2, den: 3)
        )
    }

    @Test("denominator is N even when the bar carries far more tags")
    func denominatorIsNWithMoreBarTags() {
        #expect(
            vibeMatchBadge([.cocktail, .speakeasy], [.cocktail, .speakeasy, .polished, .industry])
                == VibeMatchBadge(num: 2, den: 2)
        )
    }

    @Test("denominator is N even when the bar carries fewer tags")
    func denominatorIsNWithFewerBarTags() {
        #expect(
            vibeMatchBadge([.cocktail, .speakeasy, .polished, .industry], [.cocktail])
                == VibeMatchBadge(num: 1, den: 4)
        )
    }

    @Test("counts a duplicated pick once, in both halves of the fraction")
    func duplicatedPickCountsOnce() {
        #expect(vibeMatchBadge([.wine, .wine], [.wine]) == VibeMatchBadge(num: 1, den: 1))
    }
}

@Suite("isVibeEligible — at least max(1, N - 1) of N")
struct IsVibeEligibleTests {
    private static let T: [VibeTag] = [.cocktail, .wine, .dive, .jazz, .rooftop, .garden]

    /// A bar carrying `hit` of the first `n` selected vibes.
    private static func barWith(_ hit: Int, _ n: Int) -> [VibeTag] {
        Array(T.prefix(hit)) + (hit < n ? [.pub] : [])
    }

    private static func selectionOf(_ n: Int) -> [VibeTag] { Array(T.prefix(n)) }

    @Test("gates nothing when there is no selection")
    func gatesNothingWithNoSelection() {
        #expect(isVibeEligible([], [.pub]) == true)
    }

    @Test("admits", arguments: [(1, 1), (1, 2), (2, 2), (3, 4), (4, 4), (5, 6), (6, 6)])
    func admits(_ pair: (hit: Int, n: Int)) {
        #expect(isVibeEligible(Self.selectionOf(pair.n), Self.barWith(pair.hit, pair.n)) == true)
    }

    @Test("rejects", arguments: [(0, 1), (0, 2), (1, 4), (2, 4), (3, 6), (4, 6)])
    func rejects(_ pair: (hit: Int, n: Int)) {
        #expect(isVibeEligible(Self.selectionOf(pair.n), Self.barWith(pair.hit, pair.n)) == false)
    }

    @Test("deduplicates the selection before computing the threshold")
    func deduplicatesSelection() {
        #expect(isVibeEligible([.cocktail, .cocktail, .wine, .wine], [.cocktail, .pub]) == true)
    }
}

@Suite("matches() — filters")
struct MatchesFiltersTests {
    private let profile = baseProfile([.cocktail, .speakeasy, .polished, .industry])

    @Test("excludeIds removes the named bar")
    func excludeIdsRemovesTheNamedBar() {
        let barA = makeBar(id: "a", tags: [.cocktail, .speakeasy, .polished, .industry])
        let barB = makeBar(id: "b", tags: [.cocktail, .speakeasy, .polished, .industry])
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [barA, barB], excludeIds: ["a"], now: NOW
        ))
        #expect(result.map(\.id) == ["b"])
    }

    @Test("drops bars whose lastVerified is older than the hard-filter window")
    func dropsStaleBars() {
        let fresh = makeBar(id: "fresh", tags: [.cocktail, .speakeasy, .polished, .industry], lastVerified: FRESH)
        let stale = makeBar(id: "stale", tags: [.cocktail, .speakeasy, .polished, .industry], lastVerified: STALE)
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [fresh, stale], now: NOW
        ))
        let ids = result.map(\.id)
        #expect(ids.contains("fresh"))
        #expect(!ids.contains("stale"))
    }

    @Test("preferredNeighborhoods = [] is a no-op")
    func emptyPreferredNeighborhoodsIsNoOp() {
        let midtown = makeBar(id: "midtown", neighborhood: .midtown, tags: [.cocktail, .speakeasy, .polished, .industry])
        let fidi = makeBar(id: "fidi", neighborhood: .fiDi, tags: [.cocktail, .speakeasy, .polished, .industry])
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [midtown, fidi], now: NOW
        ))
        #expect(result.map(\.id).sorted() == ["fidi", "midtown"])
    }

    @Test("preferredNeighborhoods = [\"Midtown\"] filters out non-Midtown bars")
    func filtersOutNonMidtownBars() {
        let midtown = makeBar(id: "midtown", neighborhood: .midtown, tags: [.cocktail, .speakeasy, .polished, .industry])
        let fidi = makeBar(id: "fidi", neighborhood: .fiDi, tags: [.cocktail, .speakeasy, .polished, .industry])
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [.midtown], maxMiles: nil,
            bars: [midtown, fidi], now: NOW
        ))
        #expect(result.map(\.id) == ["midtown"])
    }

    @Test("maxMiles with coords filters by radius")
    func maxMilesFiltersByRadius() {
        let near = makeBar(id: "near", lat: 40.7550, lng: -73.9840, tags: [.cocktail, .speakeasy, .polished, .industry])
        let far = makeBar(id: "far", lat: 40.7060, lng: -74.0090, tags: [.cocktail, .speakeasy, .polished, .industry])
        let result = matches(MatchesArgs(
            profile: profile, coords: Coords(lat: 40.7550, lng: -73.9840), preferredNeighborhoods: [],
            maxMiles: 1, bars: [near, far], now: NOW
        ))
        #expect(result.map(\.id) == ["near"])
    }

    @Test("minMilesExclusive with coords removes nearer bars")
    func minMilesExclusiveRemovesNearerBars() {
        let near = makeBar(id: "near", lat: 40.7550, lng: -73.9840)
        let far = makeBar(id: "far", lat: 40.7060, lng: -74.0090)
        let result = matches(MatchesArgs(
            profile: baseProfile([]), coords: Coords(lat: 40.7550, lng: -73.9840), preferredNeighborhoods: [],
            minMilesExclusive: 1.5, maxMiles: 4, bars: [near, far], now: NOW
        ))
        #expect(result.map(\.id) == ["far"])
    }

    @Test("maxMiles set but coords === null is a no-op (no radius filter applied)")
    func maxMilesWithoutCoordsIsNoOp() {
        let near = makeBar(id: "near", lat: 40.7550, lng: -73.9840, tags: [.cocktail, .speakeasy, .polished, .industry])
        let far = makeBar(id: "far", lat: 40.7060, lng: -74.0090, tags: [.cocktail, .speakeasy, .polished, .industry])
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: 1, bars: [near, far], now: NOW
        ))
        #expect(result.map(\.id).sorted() == ["far", "near"])
    }
}

@Suite("matches() — threshold relaxation")
struct MatchesThresholdRelaxationTests {
    private let profile = baseProfile([.cocktail, .speakeasy, .polished, .industry])

    @Test("ranks stronger tag overlap above weaker, and caps the page")
    func ranksStrongerOverlapAboveWeaker() {
        let strongA = makeBar(id: "strongA", tags: [.cocktail, .speakeasy, .polished, .industry])
        let strongB = makeBar(id: "strongB", tags: [.cocktail, .speakeasy, .polished, .industry])
        let weakA = makeBar(id: "weakA", tags: [.cocktail, .dive])
        let weakB = makeBar(id: "weakB", tags: [.cocktail, .rooftop])
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [strongA, strongB, weakA, weakB], now: NOW
        ))
        #expect(result.count == 3)
        let ids = result.map(\.id)
        #expect(Array(ids.prefix(2)).sorted() == ["strongA", "strongB"])
        #expect(["weakA", "weakB"].contains(ids[2]))
    }

    @Test("admits bars with zero tag overlap — no Jaccard admission gate")
    func admitsBarsWithZeroOverlap() {
        let noOverlapA = makeBar(id: "noA", tags: [.beer, .pub, .cheap])
        let noOverlapB = makeBar(id: "noB", tags: [.wine, .romantic])
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [noOverlapA, noOverlapB], now: NOW
        ))
        #expect(result.map(\.id).sorted() == ["noA", "noB"])
    }
}

@Suite("matches() — blended ranking (vibe + proximity + loved affinity)")
struct MatchesBlendedRankingTests {
    private let profile = baseProfile([.cocktail, .speakeasy, .polished, .industry])
    private let ORIGIN = Coords(lat: 40.7550, lng: -73.9840)

    @Test("a strong vibe match slightly farther outranks a weak vibe match that is closer")
    func strongVibeMatchFartherOutranksWeakCloser() {
        let weakNear = makeBar(id: "weakNear", lat: 40.7551, lng: -73.984, tags: [.cocktail])
        let strongFar = makeBar(id: "strongFar", lat: 40.764, lng: -73.984, tags: [.cocktail, .speakeasy, .polished, .industry])
        let result = matches(MatchesArgs(
            profile: profile, coords: ORIGIN, preferredNeighborhoods: [], maxMiles: nil,
            bars: [weakNear, strongFar], now: NOW
        ))
        #expect(result.map(\.id) == ["strongFar", "weakNear"])
    }

    @Test("among equal-vibe bars, the closer one still wins (proximity breaks the tie)")
    func closerBarWinsAmongEqualVibe() {
        let near = makeBar(id: "near", lat: 40.7551, lng: -73.984, tags: [.cocktail, .speakeasy, .polished, .industry])
        let far = makeBar(id: "far", lat: 40.764, lng: -73.984, tags: [.cocktail, .speakeasy, .polished, .industry])
        let result = matches(MatchesArgs(
            profile: profile, coords: ORIGIN, preferredNeighborhoods: [], maxMiles: nil,
            bars: [far, near], now: NOW
        ))
        #expect(result.map(\.id) == ["near", "far"])
    }

    @Test("learned taste breaks ties between bars with identical quiz overlap")
    func learnedTasteBreaksTies() {
        let matchesTaste = makeBar(id: "matchesTaste", tags: [.cocktail, .speakeasy, .dive, .rough])
        let noTasteOverlap = makeBar(id: "noTasteOverlap", tags: [.cocktail, .speakeasy, .dive, .cheap])
        let seed = makeBar(id: "seed", tags: [.rough])
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [noTasteOverlap, matchesTaste],
            now: NOW,
            taste: deriveLearnedTaste(
                [BarRating(barId: "seed", rating: .loved, ratedAt: isoString(NOW), score: 10)],
                [seed]
            )
        ))
        #expect(result.map(\.id) == ["matchesTaste", "noTasteOverlap"])
    }

    @Test("omitting lovedTags is a no-op (backward compatible)")
    func omittingLovedTagsIsNoOp() {
        let a = makeBar(id: "a", tags: [.cocktail, .speakeasy, .dive, .rough])
        let b = makeBar(id: "b", tags: [.cocktail, .speakeasy, .dive, .cheap])
        let withLoved = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [a, b], now: NOW, taste: emptyTaste
        ))
        let withoutLoved = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [a, b], now: NOW
        ))
        #expect(withLoved.map(\.id) == withoutLoved.map(\.id))
    }
}

@Suite("matches() — sorting and slicing")
struct MatchesSortingAndSlicingTests {
    private let profile = baseProfile([.cocktail, .speakeasy, .polished, .industry])

    @Test("sorts by distance ascending when coords provided")
    func sortsByDistanceAscending() {
        let closest = makeBar(id: "closest", lat: 40.7550, lng: -73.9840, tags: [.cocktail, .speakeasy, .polished, .industry])
        let mid = makeBar(id: "mid", lat: 40.7470, lng: -74.0010, tags: [.cocktail, .speakeasy, .polished, .industry])
        let farthest = makeBar(id: "farthest", lat: 40.7060, lng: -74.0090, tags: [.cocktail, .speakeasy, .polished, .industry])
        let result = matches(MatchesArgs(
            profile: profile, coords: Coords(lat: 40.7550, lng: -73.9840), preferredNeighborhoods: [], maxMiles: nil,
            bars: [farthest, mid, closest], now: NOW
        ))
        #expect(result.map(\.id) == ["closest", "mid", "farthest"])
    }

    @Test("sorts by jaccard descending when coords is null")
    func sortsByJaccardDescending() {
        let perfect = makeBar(id: "perfect", tags: [.cocktail, .speakeasy, .polished, .industry])
        let partial = makeBar(id: "partial", tags: [.cocktail, .speakeasy, .dive, .rough])
        let weakest = makeBar(id: "weakest", tags: [.cocktail, .speakeasy, .dive, .rough, .cheap, .oldNyc])
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [weakest, partial, perfect], now: NOW
        ))
        #expect(result.map(\.id) == ["perfect", "partial", "weakest"])
    }

    @Test(
        "regression: bars.ts PLACEHOLDER_VERIFIED dates still pass the hard filter on 2026-09-28",
        .disabled("requires the real src/lib/bars.ts catalog, out of scope for the pure-logic port")
    )
    func placeholderVerifiedDatesRegression() {}

    @Test("caps the result set at MAX_RESULTS (3) even when 5 bars match")
    func capsAtMaxResults() {
        let fiveMatchers = (1...5).map { makeBar(id: "m\($0)", tags: [.cocktail, .speakeasy, .polished, .industry]) }
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil, bars: fiveMatchers, now: NOW
        ))
        #expect(result.count == 3)
    }

    @Test("maxResults override expands the cap (quiz path uses 10)")
    func maxResultsOverrideExpandsCap() {
        let twelveMatchers = (0..<12).map { makeBar(id: "m\($0)", tags: [.cocktail, .speakeasy, .polished, .industry]) }
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: twelveMatchers, maxResults: 10, now: NOW
        ))
        #expect(result.count == 10)
    }

    @Test("QA-6: keeps relaxing the Jaccard threshold to FILL the requested cap, not just the 3-result minimum")
    func qa6FillsRequestedCap() {
        let pool = [
            makeBar(id: "s1", tags: [.cocktail, .speakeasy, .polished, .industry]),
            makeBar(id: "s2", tags: [.cocktail, .speakeasy, .polished, .industry]),
            makeBar(id: "s3", tags: [.cocktail, .speakeasy, .polished, .industry]),
            makeBar(id: "w1", tags: [.cocktail, .dive, .beer, .garden]),
            makeBar(id: "w2", tags: [.cocktail, .dive, .beer, .rooftop]),
            makeBar(id: "w3", tags: [.cocktail, .dive, .jazz, .garden]),
            makeBar(id: "w4", tags: [.cocktail, .wine, .beer, .garden]),
        ]
        let result = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: pool, maxResults: 5, now: NOW
        ))
        #expect(result.count == 5)
        #expect(Array(result.prefix(3)).map(\.id).sorted() == ["s1", "s2", "s3"])
    }
}

@Suite("matches — empty vibe profile (location-first suggest)")
struct MatchesEmptyVibeProfileTests {
    @Test("returns proximity-ranked bars instead of filtering everything out")
    func returnsProximityRankedBars() {
        let near = makeBar(id: "near", lat: 40.7250, lng: -73.9850, tags: [.dive])
        let far = makeBar(id: "far", lat: 40.8100, lng: -73.9500, tags: [.cocktail])
        let coords = Coords(lat: 40.7250, lng: -73.9850)
        let result = matches(MatchesArgs(
            profile: baseProfile([]), coords: coords, preferredNeighborhoods: [], maxMiles: nil,
            bars: [far, near], maxResults: 5, now: NOW
        ))
        #expect(!result.isEmpty)
        #expect(result[0].id == "near")
    }
}

@Suite("permanently-closed hard filter (Places refresh 2026-07-23)")
struct PermanentlyClosedHardFilterTests {
    @Test("never suggests a CLOSED_PERMANENTLY bar even on perfect vibe match")
    func neverSuggestsClosedPermanentlyBar() {
        let open = makeBar(id: "open-bar", tags: [.dive, .chill])
        let dead = makeBar(id: "dead-bar", tags: [.dive, .chill], businessStatus: .closedPermanently)
        let ranked = matches(MatchesArgs(
            profile: VibeProfile(tags: [.dive, .chill], archetype: "t", preferredNeighborhoods: []),
            coords: nil, preferredNeighborhoods: [], maxMiles: nil, bars: [open, dead], now: NOW
        ))
        #expect(ranked.map(\.id).contains("open-bar"))
        #expect(!ranked.map(\.id).contains("dead-bar"))
    }
}

@Suite("late-night bias (operator 2026-07-27: clubs up, restaurants down after hours)")
struct LateNightBiasTests {
    private let profile = baseProfile([.cocktail])
    private let club = makeBar(id: "club", tags: [.cocktail, .club])
    private let resto = makeBar(id: "resto", tags: [.cocktail, .restaurantBar])
    private let plain = makeBar(id: "plain", tags: [.cocktail, .chill])
    // 11:30pm NEW YORK on Fri 2026-07-24 (EDT, UTC-4), as an absolute instant.
    private let LATE = isoDate("2026-07-25T03:30:00Z")
    // 3pm NYC on the same Friday — outside the window.
    private let AFTERNOON = isoDate("2026-07-24T19:00:00Z")

    private func rank(_ biasNow: Date?) -> [String] {
        matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [resto, plain, club], maxResults: 3, now: NOW, biasNow: biasNow
        )).map(\.id)
    }

    @Test("at 11:30pm the club leads and the restaurant-bar trails")
    func clubLeadsAtLateNight() {
        #expect(rank(LATE) == ["club", "plain", "resto"])
    }

    @Test("at 3pm identical-vibe venues stay un-biased")
    func unbiasedInAfternoon() {
        let ids = rank(AFTERNOON)
        #expect(Set(ids) == Set(["club", "plain", "resto"]))
        #expect(rank(AFTERNOON) == rank(nil))
    }

    @Test("a restaurant that is ALSO a club keeps its night credibility")
    func hybridKeepsNightCredibility() {
        let hybrid = makeBar(id: "hybrid", tags: [.cocktail, .restaurantBar, .club])
        let ids = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: [resto, hybrid], maxResults: 2, now: NOW, biasNow: LATE
        )).map(\.id)
        #expect(ids == ["hybrid", "resto"])
    }

    @Test("the window wraps midnight: 3:59am biased, 4:00am not — in NEW YORK")
    func windowWrapsMidnight() {
        #expect(isLateNight(isoDate("2026-07-25T07:59:00Z")) == true) // 3:59am NYC
        #expect(isLateNight(isoDate("2026-07-25T08:00:00Z")) == false) // 4:00am NYC
        #expect(isLateNight(isoDate("2026-07-25T02:00:00Z")) == true) // 10:00pm NYC
        #expect(isLateNight(isoDate("2026-07-25T01:59:00Z")) == false) // 9:59pm NYC
    }

    @Test("a broken clock gets no night bias rather than a wrong one")
    func brokenClockGetsNoBias() {
        #expect(isLateNight(Date(timeIntervalSince1970: .nan)) == false)
    }
}

@Suite("matches() — V8 distance-band cascade")
struct MatchesDistanceBandCascadeTests {
    private static let ORIGIN = Coords(lat: 40.7550, lng: -73.9840)

    private static func atMiles(_ id: String, _ miles: Double, _ tags: [VibeTag] = [.dive]) -> Bar {
        makeBar(id: id, lat: ORIGIN.lat + miles / 69, lng: ORIGIN.lng, tags: tags)
    }

    private let profile = baseProfile([.dive])

    private func run(_ bars: [Bar], _ maxResults: Int = 5) -> [String] {
        matches(MatchesArgs(
            profile: profile, coords: Self.ORIGIN, preferredNeighborhoods: [], maxMiles: nil,
            bars: bars, maxResults: maxResults, now: NOW
        )).map(\.id)
    }

    @Test("fills all five slots from the walk band when it can")
    func fillsAllFiveFromWalkBand() {
        let near = [0.2, 0.4, 0.6, 0.8, 1.0].enumerated().map { Self.atMiles("near\($0.offset)", $0.element) }
        let cab = [2, 2.5, 3].enumerated().map { Self.atMiles("cab\($0.offset)", $0.element) }
        let far = [5, 6].enumerated().map { Self.atMiles("far\($0.offset)", $0.element) }
        let ids = run(far + cab + near)
        #expect(ids.count == 5)
        #expect(ids.allSatisfy { $0.hasPrefix("near") })
    }

    @Test("expands into the cab band ONLY when the walk band cannot fill")
    func expandsIntoCabBandOnlyWhenNeeded() {
        let near = [0.5, 1.0].enumerated().map { Self.atMiles("near\($0.offset)", $0.element) }
        let cab = [2, 2.5, 3, 3.5].enumerated().map { Self.atMiles("cab\($0.offset)", $0.element) }
        let ids = run(cab + near)
        #expect(ids.count == 5)
        #expect(Array(ids.prefix(2)).sorted() == ["near0", "near1"])
        #expect(ids.dropFirst(2).allSatisfy { $0.hasPrefix("cab") })
    }

    @Test("expands to the outer band only after walk AND cab are exhausted")
    func expandsToOuterBandOnlyAfterExhaustion() {
        let near = [Self.atMiles("near0", 1.0)]
        let cab = [Self.atMiles("cab0", 3.0)]
        let far = [8, 9, 10].enumerated().map { Self.atMiles("far\($0.offset)", $0.element) }
        let ids = run(far + cab + near)
        #expect(Array(ids.prefix(2)) == ["near0", "cab0"])
        #expect(ids.dropFirst(2).allSatisfy { $0.hasPrefix("far") })
    }

    @Test("treats the band edges as inclusive upper bounds (<= 1.5 walks, <= 4 cabs)")
    func treatsBandEdgesAsInclusive() {
        let onWalkEdge = Self.atMiles("walk-edge", 1.49)
        let justOver = Self.atMiles("cab-side", 1.55)
        let ids = run([justOver, onWalkEdge], 1)
        #expect(ids == ["walk-edge"])
    }

    @Test("orders WITHIN a band by learned taste, not by distance")
    func ordersWithinBandByLearnedTaste() {
        let closeBland = Self.atMiles("close-bland", 0.2, [.cheap])
        let fartherLoved = Self.atMiles("farther-loved", 1.2, [.club])
        let taste = deriveLearnedTaste(
            (0..<40).map { BarRating(barId: "seed\($0)", rating: .loved, ratedAt: isoString(NOW), score: 10) },
            (0..<40).map { makeBar(id: "seed\($0)", tags: [.club]) }
        )
        let ids = matches(MatchesArgs(
            profile: baseProfile([]), coords: Self.ORIGIN, preferredNeighborhoods: [], maxMiles: nil,
            bars: [closeBland, fartherLoved], maxResults: 2, now: NOW, taste: taste
        )).map(\.id)
        #expect(ids == ["farther-loved", "close-bland"])
    }

    @Test("a full nearer band EXCLUDES a much better-tasting farther bar")
    func fullNearerBandExcludesBetterTastingFartherBar() {
        let bad = (0..<40).map { BarRating(barId: "bad\($0)", rating: .pass, ratedAt: isoString(NOW), score: 1) }
        let good = (0..<40).map { BarRating(barId: "good\($0)", rating: .loved, ratedAt: isoString(NOW), score: 10) }
        let hated = deriveLearnedTaste(
            bad + good,
            (0..<40).map { makeBar(id: "bad\($0)", tags: [.cheap]) }
                + (0..<40).map { makeBar(id: "good\($0)", tags: [.club]) }
        )
        let walkBand = [0.2, 0.4, 0.6, 0.8, 1.0].enumerated().map { Self.atMiles("near\($0.offset)", $0.element, [.cheap]) }
        let belovedButFar = Self.atMiles("beloved-far", 3.5, [.club])
        let ids = matches(MatchesArgs(
            profile: baseProfile([]), coords: Self.ORIGIN, preferredNeighborhoods: [], maxMiles: nil,
            bars: [belovedButFar] + walkBand, maxResults: 5, now: NOW, taste: hated
        )).map(\.id)
        #expect(ids.count == 5)
        #expect(!ids.contains("beloved-far"))
        #expect(ids.allSatisfy { $0.hasPrefix("near") })
    }

    @Test("learned evidence eventually overrides a conflicting quiz prior")
    func learnedEvidenceOverridesQuizPrior() {
        let clubLover = deriveLearnedTaste(
            (0..<40).map { BarRating(barId: "s\($0)", rating: .loved, ratedAt: isoString(NOW), score: 10) },
            (0..<40).map { makeBar(id: "s\($0)", tags: [.club]) }
        )
        let quizPick = Self.atMiles("quiz-pick", 0.5, [.cheap])
        let tastePick = Self.atMiles("taste-pick", 0.6, [.club])
        func run(taste: LearnedTaste) -> [String] {
            matches(MatchesArgs(
                profile: baseProfile([.cheap]), coords: Self.ORIGIN, preferredNeighborhoods: [], maxMiles: nil,
                bars: [quizPick, tastePick], maxResults: 2, now: NOW, taste: taste
            )).map(\.id)
        }
        #expect(run(taste: emptyTaste).first == "quiz-pick")
        #expect(run(taste: clubLover).first == "taste-pick")
    }

    @Test("uses exact miles ONLY as the final tie-breaker")
    func usesExactMilesOnlyAsTieBreaker() {
        let farther = Self.atMiles("farther", 1.2)
        let closer = Self.atMiles("closer", 0.3)
        #expect(run([farther, closer], 2) == ["closer", "farther"])
    }

    @Test("falls back to a single band when there are no coords")
    func fallsBackToSingleBandWithNoCoords() {
        let bars = [Self.atMiles("a", 0.5), Self.atMiles("b", 9)]
        let ids = matches(MatchesArgs(
            profile: profile, coords: nil, preferredNeighborhoods: [], maxMiles: nil,
            bars: bars, maxResults: 5, now: NOW
        )).map(\.id)
        #expect(ids.sorted() == ["a", "b"])
    }
}

private func isoString(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
}
