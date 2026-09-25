import Testing
@testable import NextBarCore

/// Ports `src/lib/vibeAxes.test.ts`. TS's `TAG_VOCABULARY` (from
/// `src/lib/catalog.ts`, out of this port's scope) is "every known VibeTag" —
/// `VibeTag.allCases` is the same 35-tag set, verified equal in count to the
/// union `vibeAxes.ts` partitions.
struct VibeAxesTests {
    @Test("partitions the ENTIRE vocabulary — every tag in exactly one axis")
    func partitionsEntireVocabulary() {
        var seen: [VibeTag: VibeAxis] = [:]
        for axis in axisOrder {
            for tag in vibeAxes[axis] ?? [] {
                #expect(seen[tag] == nil, "\(tag) appears in both \(String(describing: seen[tag])) and \(axis)")
                seen[tag] = axis
            }
        }
        #expect(Set(seen.keys) == Set(VibeTag.allCases))
    }

    @Test("axisOf round-trips membership for every tag")
    func axisOfRoundTrips() {
        for tag in VibeTag.allCases {
            let axis = axisOf(tag)
            #expect(vibeAxes[axis]?.contains(tag) == true)
        }
    }

    @Test("AXIS_ORDER lists all six axes exactly once")
    func axisOrderListsAllSix() {
        #expect(Set(axisOrder) == Set(VibeAxis.allCases))
        #expect(Set(axisOrder).count == axisOrder.count)
    }

    @Test("Spend is exactly the price ladder in ascending order")
    func spendIsThePriceLadder() {
        #expect(vibeAxes[.spend] == [.cheap, .mid, .pricey, .splurge])
    }
}
