import Foundation
import Testing
@testable import NextBarCore

/// Ports `src/lib/travelTime.test.ts`.
@Suite("street route display")
struct StreetRouteDisplayTests {
    @Test("uses raw seconds for Walkable and never rounds a longer walk down to 15")
    func rawSecondsForWalkable() {
        #expect(isWalkable(RouteEstimate(seconds: 900, meters: 1100)) == true)
        #expect(isWalkable(RouteEstimate(seconds: 901, meters: 1100)) == false)
        #expect(isWalkable(RouteEstimate(seconds: 1320, meters: 1700)) == false)
        #expect(routeCopy(RouteEstimate(seconds: 901, meters: 1100), mode: .walking) == "Walk ~16 min \u{00B7} 0.7 mi")
        #expect(routeCopy(RouteEstimate(seconds: 300, meters: 3218.688), mode: .driving) == "Drive ~5 min \u{00B7} 2.0 mi")
    }

    @Test("does not infer minutes or walkability from unknown or straight-line distances")
    func doesNotInferFromUnknownDistances() {
        #expect(isWalkable(nil) == false)
        #expect(isWalkable(RouteEstimate(seconds: .nan, meters: 20)) == false)
        #expect(routeCopy(nil, mode: .walking) == "Walk time unavailable")
        #expect(routeCopy(nil, mode: .driving) == "Drive time unavailable")
    }

    @Test("pins Maps to the same coordinates and explicit mode, without name ambiguity")
    func pinsMapsToSameCoordinates() {
        let origin = Coords(lat: 40.75, lng: -74)
        let destination = Coords(lat: 40.7542853, lng: -73.9953313)
        for mode: TravelMode in [.walking, .driving] {
            let href = directionsHref(origin: origin, destination: destination, mode: mode)
            let components = URLComponents(string: href)!
            let items = components.queryItems ?? []
            func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
            #expect(value("origin") == "40.75,-74")
            #expect(value("destination") == "40.7542853,-73.9953313")
            #expect(value("travelmode") == mode.rawValue)
        }
        let noOriginHref = directionsHref(origin: nil, destination: destination, mode: .walking)
        let noOriginParams = URLComponents(string: noOriginHref)!.queryItems ?? []
        #expect(!noOriginParams.contains { $0.name == "origin" })
    }
}

/// Ports the top-level (non-`describe`-nested) TS test in the same file.
@Test("separates the route boundary, cab edge, and unknown routes without overlapping bands")
func separatesRouteBoundaryAndCabEdge() {
    let origin = Coords(lat: 40.75, lng: -74)
    let near = Coords(lat: 40.76, lng: -74)
    let far = Coords(lat: 40.85, lng: -74)
    let bands: [TravelBand] = [.walkable, .cab, .anywhere]

    func admitted(_ destination: Coords, _ seconds: Double?) -> [TravelBand] {
        bands.filter {
            matchesTravelBand(
                origin: origin, destination: destination,
                walking: seconds.map { RouteEstimate(seconds: $0, meters: 1500) }, band: $0
            )
        }
    }

    #expect(admitted(near, 900) == [.walkable])
    #expect(admitted(near, 901) == [.cab])
    #expect(admitted(near, nil) == [])
    #expect(admitted(far, 5000) == [.anywhere])
    #expect(admitted(far, nil) == [.anywhere])
    #expect(admitted(Coords(lat: 0, lng: 0), nil) == [])
}
