import Foundation

/// Ports `src/types/index.ts`: `Coords`.
public struct Coords: Codable, Equatable, Hashable, Sendable {
    public var lat: Double
    public var lng: Double

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }
}

/// Ports `src/types/index.ts`: `Neighborhood` (raw values are the exact TS string
/// literals). `ManhattanNeighborhood` was a back-compat alias in TS for the same
/// type; Swift callers just use `Neighborhood` directly.
public enum Neighborhood: String, Codable, CaseIterable, Hashable, Sendable {
    // Manhattan
    case fiDi = "FiDi"
    case les = "LES"
    case eastVillage = "East Village"
    case westVillage = "West Village"
    case soHo = "SoHo"
    case chelsea = "Chelsea"
    case midtown = "Midtown"
    case hellsKitchen = "Hell's Kitchen"
    case uws = "UWS"
    case ues = "UES"
    case harlem = "Harlem"
    // Manhattan expansion 2026-07-27
    case tribeca = "Tribeca"
    case batteryParkCity = "Battery Park City"
    case hamiltonHeights = "Hamilton Heights"
    case flatiron = "Flatiron"
    case greenwichVillage = "Greenwich Village"
    case noHo = "NoHo"
    case hudsonSquare = "Hudson Square"
    case gramercy = "Gramercy"
    case kipsBay = "Kips Bay"
    case eastHarlem = "East Harlem"
    case morningsideHeights = "Morningside Heights"
    case washingtonHeights = "Washington Heights"
    case inwood = "Inwood"
    case chinatown = "Chinatown"
    // Brooklyn
    case williamsburg = "Williamsburg"
    case greenpoint = "Greenpoint"
    case bushwick = "Bushwick"
    case parkSlope = "Park Slope"
    case fortGreene = "Fort Greene"
    case gowanus = "Gowanus"
    // Queens
    case astoria = "Astoria"
    case lic = "LIC"
    case ridgewood = "Ridgewood"
}

/// Ports `src/types/index.ts`: `VibeTag` (raw values are the exact TS string
/// literals, including hyphenated tags).
public enum VibeTag: String, Codable, CaseIterable, Hashable, Sendable {
    case dive, cocktail, wine, beer, dance, lounge, speakeasy, pub, rooftop, garden, club
    case restaurantBar = "restaurant-bar"
    case chill, buzzy, loud, locals
    case postWork = "post-work"
    case date, tourist, industry, rough, polished, romantic, instagrammable
    case oldNyc = "old-nyc"
    case trendy, indie, hiphop, house, jazz, live, cheap, mid, pricey, splurge
}

/// Ports `src/types/index.ts`: `VibeProfile`.
public struct VibeProfile: Codable, Equatable, Sendable {
    public var tags: [VibeTag]
    public var archetype: String
    public var preferredNeighborhoods: [Neighborhood]
    /// True when `tags` is an APPLIED Tweak-the-vibe pick rather than the quiz
    /// prior. See `matching.ts`'s `EXPLICIT_VIBE_WEIGHT` doc comment.
    public var isExplicitVibe: Bool?

    public init(
        tags: [VibeTag],
        archetype: String,
        preferredNeighborhoods: [Neighborhood],
        isExplicitVibe: Bool? = nil
    ) {
        self.tags = tags
        self.archetype = archetype
        self.preferredNeighborhoods = preferredNeighborhoods
        self.isExplicitVibe = isExplicitVibe
    }
}

/// Ports `src/types/index.ts`: `BusinessStatus`.
public enum BusinessStatus: String, Codable, Sendable {
    case operational = "OPERATIONAL"
    case closedTemporarily = "CLOSED_TEMPORARILY"
    case closedPermanently = "CLOSED_PERMANENTLY"
}

/// Ports `src/types/index.ts`: `TimeRange`.
public struct TimeRange: Codable, Equatable, Sendable {
    public var open: String
    public var close: String

    public init(open: String, close: String) {
        self.open = open
        self.close = close
    }
}

/// Ports `src/types/index.ts`: `WeeklyHours` (day-of-week 0...6, Sunday first).
public typealias WeeklyHours = [Int: [TimeRange]]

/// Ports `src/types/index.ts`: `BarReview`.
public struct BarReview: Codable, Equatable, Sendable {
    public var text: String
    public var author: String
    public var rating: Double

    public init(text: String, author: String, rating: Double) {
        self.text = text
        self.author = author
        self.rating = rating
    }
}

/// Ports `src/types/index.ts`: `Bar`. `PlacePatch` (the Places-refresh overlay
/// type) is not ported — it is a data-ingestion shape, not ranking logic.
public struct Bar: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var neighborhood: Neighborhood
    public var address: String
    public var lat: Double
    public var lng: Double
    public var priceTier: Int
    public var tags: [VibeTag]
    public var blurb: String
    public var igHandle: String?
    public var lastVerified: String
    public var googlePlaceId: String?
    public var businessStatus: BusinessStatus?
    public var hours: WeeklyHours?
    public var photoRef: String?
    public var photoAttribution: String?
    public var photoCount: Int?
    public var photoAttributions: [String]?
    public var reviews: [BarReview]?

    public init(
        id: String,
        name: String,
        neighborhood: Neighborhood,
        address: String,
        lat: Double,
        lng: Double,
        priceTier: Int,
        tags: [VibeTag],
        blurb: String,
        igHandle: String? = nil,
        lastVerified: String,
        googlePlaceId: String? = nil,
        businessStatus: BusinessStatus? = nil,
        hours: WeeklyHours? = nil,
        photoRef: String? = nil,
        photoAttribution: String? = nil,
        photoCount: Int? = nil,
        photoAttributions: [String]? = nil,
        reviews: [BarReview]? = nil
    ) {
        self.id = id
        self.name = name
        self.neighborhood = neighborhood
        self.address = address
        self.lat = lat
        self.lng = lng
        self.priceTier = priceTier
        self.tags = tags
        self.blurb = blurb
        self.igHandle = igHandle
        self.lastVerified = lastVerified
        self.googlePlaceId = googlePlaceId
        self.businessStatus = businessStatus
        self.hours = hours
        self.photoRef = photoRef
        self.photoAttribution = photoAttribution
        self.photoCount = photoCount
        self.photoAttributions = photoAttributions
        self.reviews = reviews
    }
}

extension Bar {
    /// Ports the `haversineMiles(coords, b)` call in `matching.ts`, where a
    /// `Bar` is used directly as a `{ lat, lng }` pair.
    public var coords: Coords { Coords(lat: lat, lng: lng) }
}
