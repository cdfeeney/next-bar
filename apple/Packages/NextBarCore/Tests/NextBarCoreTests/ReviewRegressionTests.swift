import Foundation
import Testing
@testable import NextBarCore

// Regressions from the 2026-09-25 review round of the port (Codex MEDIUM ×2,
// Codex LOW, Fable LOW). Each mirrors the TS behaviour the reviewer cited.
@Suite("review regressions") struct ReviewRegressionTests {
    private static let now = parseISODate("2026-05-15T12:00:00Z")!

    @Test("a negative maxResults returns an empty list like JS slice(0, negative), never traps")
    func negativeCapIsEmpty() {
        let bar = Bar(id: "a", name: "A", neighborhood: .midtown, address: "", lat: 40.755, lng: -73.984,
                      priceTier: 2, tags: [.cocktail], blurb: "", lastVerified: "2026-04-01", businessStatus: nil)
        let profile = VibeProfile(tags: [.cocktail], archetype: "", preferredNeighborhoods: [])
        let result = matches(MatchesArgs(profile: profile, coords: nil, preferredNeighborhoods: [],
                                         maxMiles: nil, bars: [bar], maxResults: -1, now: Self.now))
        #expect(result.isEmpty)
    }

    @Test("daysAgo accepts an ISO offset and a six-digit fraction like JS new Date(iso)")
    func daysAgoAcceptsPostgresShapes() {
        #expect(daysAgo("2026-05-14T12:00:00+00:00", now: Self.now) == 1)
        #expect(daysAgo("2026-05-14T11:00:00.123456Z", now: Self.now) == 1)
        #expect(daysAgo("2026-05-14T08:00:00-04:00", now: Self.now) == 1)
        #expect(daysAgo("2026-05-14", now: Self.now) == 1)
        #expect(daysAgo("garbage", now: Self.now) == .infinity)
    }

    @Test("nycHour returns nan for an infinite date, not a Calendar trap")
    func nycHourInfiniteIsNaN() {
        #expect(nycHour(Date(timeIntervalSince1970: .infinity)).isNaN)
        #expect(nycHour(Date(timeIntervalSince1970: -.infinity)).isNaN)
    }

    @Test("directionsHref percent-encodes the comma in lat,lng like URLSearchParams")
    func directionsHrefEncodesComma() {
        let href = directionsHref(origin: Coords(lat: 40.75, lng: -74), destination: Coords(lat: 40.76, lng: -73.99), mode: .walking)
        #expect(href.contains("40.75%2C-74"))
        #expect(!href.contains("40.75,-74"))
    }
}
