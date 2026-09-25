import Foundation

/// Ports `src/lib/distance.ts`.
private let earthRadiusMiles: Double = 3958.8

private func toRadians(_ degrees: Double) -> Double { degrees * Double.pi / 180 }

public func haversineMiles(_ a: Coords, _ b: Coords) -> Double {
    let dLat = toRadians(b.lat - a.lat)
    let dLng = toRadians(b.lng - a.lng)
    let lat1 = toRadians(a.lat)
    let lat2 = toRadians(b.lat)

    let sinDLat = sin(dLat / 2)
    let sinDLng = sin(dLng / 2)

    let h = sinDLat * sinDLat + cos(lat1) * cos(lat2) * sinDLng * sinDLng
    let c = 2 * atan2(h.squareRoot(), (1 - h).squareRoot())
    return earthRadiusMiles * c
}
