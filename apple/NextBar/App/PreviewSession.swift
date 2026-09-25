import Foundation
import NextBarCore

/// In-memory `Session` used by every screen, the UI tests (`-uiTesting`), and
/// SwiftUI previews. It never touches the network.
///
/// `travel()` always returns an empty dictionary — i.e. every destination has
/// "nil routes", per the mission spec — so Next Bar? home exercises its real
/// "Route times unavailable" fallback rather than a fabricated ETA.
///
/// Not thread-safe by design (see `Session`'s doc comment) — every call in
/// this app comes from the main actor.
public final class PreviewSession: Session {
    private var profile = VibeProfile(tags: [], archetype: deriveArchetype([]), preferredNeighborhoods: [])
    private var claimedHandles: Set<String> = ["taken", "connor", "admin"]

    public init() {}

    public func currentProfile() -> VibeProfile { profile }

    public func saveProfile(_ profile: VibeProfile) async {
        self.profile = profile
    }

    public func isHandleAvailable(_ handle: String) async -> Bool {
        !claimedHandles.contains(handle.lowercased())
    }

    public func claimHandle(_ handle: String) async throws {
        let normalized = handle.lowercased()
        guard !claimedHandles.contains(normalized) else { throw SessionError.handleTaken }
        claimedHandles.insert(normalized)
    }

    public func searchHandles(_ query: String) async -> [HandleSearchResult] {
        guard !query.isEmpty else { return [] }
        let all = [
            HandleSearchResult(id: "u1", handle: "maya.nyc", displayName: "Maya"),
            HandleSearchResult(id: "u2", handle: "jordan_", displayName: "Jordan"),
            HandleSearchResult(id: "u3", handle: "sam.rivera", displayName: "Sam Rivera"),
        ]
        let needle = query.lowercased()
        return all.filter { $0.handle.lowercased().contains(needle) }
    }

    public func requestMagicLink(email: String) async throws {
        // No real email is sent in the stub; the Check-inbox screen advances
        // on its own "Open Mail" tap until the AASA deep link is live.
    }

    public func bars() async -> [Bar] {
        Self.fixedManhattanBars
    }

    public func travel(
        origin: Coords,
        destinationIDs: [String],
        mode: TravelMode,
        walkableOnly: Bool,
        band: TravelBand
    ) async -> [String: RouteEstimate] {
        if ProcessInfo.processInfo.arguments.contains("-uiTesting") {
            // XCUITest needs the "checking routes" phase to be observable
            // for a real wall-clock window, not just one run-loop turn.
            try? await Task.sleep(for: .seconds(1.5))
        } else {
            // A real suspension point (not a delay) so callers like
            // NextBarHomeView genuinely render their "checking routes" phase
            // for at least one run-loop turn instead of it being optimized
            // away by an instantly-resolving stub.
            await Task.yield()
        }
        return [:]
    }

    /// Computed at process start, not a literal — a fixed past date would
    /// eventually age past `Matching`'s `lastVerifiedHardFilterDays` (365)
    /// and the stub catalog would silently start filtering itself down to
    /// zero results.
    private static let isoToday: String = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }()

    /// Eight fixed bars spanning the walkable / cab / anywhere bands from a
    /// West Village origin, so the distance segmented control has something
    /// real to filter.
    static let fixedManhattanBars: [Bar] = [
        Bar(
            id: "bar-1", name: "Amaro Room", neighborhood: .westVillage,
            address: "12 Cornelia St, New York, NY", lat: 40.7317, lng: -74.0022,
            priceTier: 3, tags: [.speakeasy, .cocktail, .romantic],
            blurb: "A tucked-away cocktail room behind an unmarked door.",
            lastVerified: isoToday, businessStatus: .operational
        ),
        Bar(
            id: "bar-2", name: "Old Town Ale House", neighborhood: .westVillage,
            address: "45 Bedford St, New York, NY", lat: 40.7326, lng: -74.0055,
            priceTier: 1, tags: [.pub, .oldNyc, .locals],
            blurb: "Cold pints, dark wood, regulars since the '70s.",
            lastVerified: isoToday, businessStatus: .operational
        ),
        Bar(
            id: "bar-3", name: "Dive & Dagger", neighborhood: .eastVillage,
            address: "88 Avenue B, New York, NY", lat: 40.7256, lng: -73.9799,
            priceTier: 1, tags: [.dive, .rough, .cheap],
            blurb: "Jukebox, cheap beer, no pretense.",
            lastVerified: isoToday, businessStatus: .operational
        ),
        Bar(
            id: "bar-4", name: "The Garden Room", neighborhood: .chelsea,
            address: "210 W 23rd St, New York, NY", lat: 40.7440, lng: -73.9970,
            priceTier: 2, tags: [.garden, .chill],
            blurb: "A quiet backyard for a slow first drink.",
            lastVerified: isoToday, businessStatus: .operational
        ),
        Bar(
            id: "bar-5", name: "High Line Social", neighborhood: .chelsea,
            address: "540 W 27th St, New York, NY", lat: 40.7513, lng: -74.0037,
            priceTier: 3, tags: [.rooftop, .instagrammable, .trendy],
            blurb: "Skyline views over the rail yards.",
            lastVerified: isoToday, businessStatus: .operational
        ),
        Bar(
            id: "bar-6", name: "Gowanus Tap", neighborhood: .gowanus,
            address: "365 Bond St, Brooklyn, NY", lat: 40.6774, lng: -73.9897,
            priceTier: 2, tags: [.beer, .locals, .indie],
            blurb: "Local taps in a converted warehouse.",
            lastVerified: isoToday, businessStatus: .operational
        ),
        Bar(
            id: "bar-7", name: "Bushwick Bonfire", neighborhood: .bushwick,
            address: "99 Wyckoff Ave, Brooklyn, NY", lat: 40.7005, lng: -73.9236,
            priceTier: 2, tags: [.club, .dance, .loud],
            blurb: "DJs until close, no cover before midnight.",
            lastVerified: isoToday, businessStatus: .operational
        ),
        Bar(
            id: "bar-8", name: "Astoria Nights", neighborhood: .astoria,
            address: "31-15 Broadway, Queens, NY", lat: 40.7614, lng: -73.9250,
            priceTier: 2, tags: [.jazz, .lounge, .chill],
            blurb: "A low-lit lounge with a house trio on weekends.",
            lastVerified: isoToday, businessStatus: .operational
        ),
    ]

    /// The stub "current location" — West Village — used by Next Bar? home.
    static let previewOrigin = Coords(lat: 40.7359, lng: -74.0036)
}
