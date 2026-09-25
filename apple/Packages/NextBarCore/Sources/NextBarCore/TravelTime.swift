import Foundation

/// Ports `src/lib/travelTime.ts`.
public enum TravelMode: String, Sendable {
    case walking
    case driving
}

public enum TravelBand: String, Sendable {
    case walkable
    case cab
    case anywhere
    case nearby
}

public struct RouteEstimate: Sendable {
    public let seconds: Double
    public let meters: Double

    public init(seconds: Double, meters: Double) {
        self.seconds = seconds
        self.meters = meters
    }
}

public let walkableSeconds: Double = 900
public let routeCandidateCap: Int = 15
public let routeResultCap: Int = 5
/// ORS foot-walking moves at 5 km/h; no bar farther than this straight-line
/// can be a `walkableSeconds` walk.
public let walkingMetersPerSecond: Double = 5000 / 3600
public let walkableFloorMiles: Double = (walkableSeconds * walkingMetersPerSecond) / 1609.344

/// Ports `isRouteEstimate` — a runtime validity check (finite, non-negative),
/// not just a presence check, since an untrusted/serialized route can still
/// carry NaN or negative fields.
public func isRouteEstimate(_ value: RouteEstimate?) -> Bool {
    guard let route = value else { return false }
    return route.seconds.isFinite && route.seconds >= 0
        && route.meters.isFinite && route.meters >= 0
}

public func isWalkable(_ route: RouteEstimate?) -> Bool {
    isRouteEstimate(route) && route!.seconds <= walkableSeconds
}

/// Unknown walking routes cannot establish membership in either inner band.
public func matchesTravelBand(
    origin: Coords, destination: Coords, walking: RouteEstimate?, band: TravelBand
) -> Bool {
    if band == .nearby { return true }
    guard destination.lat >= serviceAreaBBox.minLat, destination.lat <= serviceAreaBBox.maxLat,
        destination.lng >= serviceAreaBBox.minLng, destination.lng <= serviceAreaBBox.maxLng
    else { return false }
    let miles = haversineMiles(origin, destination)
    if band == .anywhere { return miles > radiusCab }
    return miles <= radiusCab && isRouteEstimate(walking)
        && (band == .walkable ? isWalkable(walking) : !isWalkable(walking))
}

public func routeCopy(_ route: RouteEstimate?, mode: TravelMode) -> String {
    let label = mode == .walking ? "Walk" : "Drive"
    guard isRouteEstimate(route), let route else { return "\(label) time unavailable" }
    // Round up so a 901-second walk never displays as a 15-minute walk.
    let minutes = max(1, Int((route.seconds / 60).rounded(.up)))
    let miles = String(format: "%.1f", route.meters / 1609.344)
    return "\(label) ~\(minutes) min \u{00B7} \(miles) mi"
}

/// Formats a `Double` the way JS's `Number.prototype.toString()` would for the
/// plain decimal literals this port's coordinates use (no trailing ".0" on
/// whole numbers, no scientific notation for ordinary lat/lng magnitudes).
private func jsNumberString(_ x: Double) -> String {
    if x.truncatingRemainder(dividingBy: 1) == 0, abs(x) < 1e15 {
        return String(Int64(x))
    }
    return String(x)
}

/// Private directions only. Public share links deliberately do not call this.
public func directionsHref(origin: Coords?, destination: Coords, mode: TravelMode) -> String {
    var components = URLComponents(string: "https://www.google.com/maps/dir/")!
    var items = [
        URLQueryItem(name: "api", value: "1"),
        URLQueryItem(
            name: "destination",
            value: "\(jsNumberString(destination.lat)),\(jsNumberString(destination.lng))"
        ),
        URLQueryItem(name: "travelmode", value: mode.rawValue),
    ]
    if let origin {
        items.append(
            URLQueryItem(name: "origin", value: "\(jsNumberString(origin.lat)),\(jsNumberString(origin.lng))")
        )
    }
    components.queryItems = items
    // URLSearchParams percent-encodes the comma in "lat,lng"; URLComponents
    // leaves it. Match the TS href byte for byte (Fable review 2026-09-25).
    components.percentEncodedQuery = components.percentEncodedQuery?
        .replacingOccurrences(of: ",", with: "%2C")
    return components.url?.absoluteString ?? ""
}
