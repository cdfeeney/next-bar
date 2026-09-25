import Testing
@testable import NextBarCore

/// `src/lib/distance.ts` has no dedicated TS test file (verified: no
/// `distance.test.ts` in `src/lib`) — `haversineMiles` is exercised indirectly
/// by the TS fixtures in `matching.test.ts`'s distance-band cascade (e.g. the
/// "~0.0145 deg lat ~= 1 mile" helper), ported in MatchingTests.swift. This is
/// the smallest standalone self-check for the function itself.
struct HaversineTests {
    @Test("is zero for identical points")
    func zeroForIdenticalPoints() {
        let p = Coords(lat: 40.7550, lng: -73.9840)
        #expect(haversineMiles(p, p) == 0)
    }

    @Test("matches the ~69 miles-per-degree-latitude approximation matching.test.ts relies on")
    func matchesDegreeLatitudeApproximation() {
        let origin = Coords(lat: 40.7550, lng: -73.9840)
        let oneMileNorth = Coords(lat: origin.lat + 1.0 / 69.0, lng: origin.lng)
        let miles = haversineMiles(origin, oneMileNorth)
        #expect(abs(miles - 1.0) < 0.01)
    }

    @Test("is symmetric")
    func isSymmetric() {
        let a = Coords(lat: 40.7550, lng: -73.9840)
        let b = Coords(lat: 40.7060, lng: -74.0090)
        #expect(abs(haversineMiles(a, b) - haversineMiles(b, a)) < 1e-9)
    }
}
