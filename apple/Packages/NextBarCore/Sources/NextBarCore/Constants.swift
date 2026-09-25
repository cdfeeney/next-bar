import Foundation

/// Ports `src/lib/constants.ts`. Every named number keeps its TS value; do not
/// re-tune silently, per the TS file's own comments (these are product
/// decisions, not knobs).

/// Legacy adaptive-Jaccard floor. No longer read by `matches()` (the V8
/// cascade removed the admission gate); kept for fidelity with `constants.ts`.
public let jaccardFloor: Double = 0.10

/// The matcher's default cap for small companion surfaces (Group Favorites,
/// consensus). The main Next Bar results view uses `resultsCount` (5).
public let maxResults: Int = 3

/// QA-6 (2026-07-27): the one Next Bar results view surfaces 5 suggestions.
public let resultsCount: Int = 5

/// Exploration slot threshold (B7b) — the feature itself was removed
/// 2026-08-19; the constant is kept for fidelity with `constants.ts`.
public let explorationMinResults: Int = 10

/// Bumped from 180 to 365 for v0.3.1 to buy time until per-bar verification.
public let lastVerifiedHardFilterDays: Int = 365
public let lastVerifiedFreshDays: Int = 90

public let coarseAccuracyM: Double = 200
public let maxSnapMiles: Double = 2

/// Legacy distance band for non-routed matchers and `Radius`'s literal
/// identity. ResultsView uses street-route eligibility (900s), not this.
public let radiusWalk: Double = 1.5

/// Late-night ranking bias window and magnitude (operator 2026-07-27,
/// rescaled 0.06 -> 0.12 on 2026-08-19). See `matching.ts` for the rationale.
public let lateNightStartHour: Int = 22 // 10pm...
public let lateNightEndHour: Int = 4 // ...through 3:59am
public let lateClubBoost: Double = 0.12
public let lateRestaurantPenalty: Double = 0.12
public let radiusCab: Double = 4
public let radiusAnywhere: Double? = nil

/// E3.3: the open-now hard filter keeps bars OPENING within this window.
public let opensSoonWindowMin: Int = 60

/// Ports `constants.ts`'s `SERVICE_AREA_BBOX`.
public struct ServiceAreaBBox: Sendable {
    public let minLat: Double
    public let maxLat: Double
    public let minLng: Double
    public let maxLng: Double
}

/// Service area now spans lower/mid Manhattan + north/central Brooklyn + LIC/Astoria/Ridgewood.
public let serviceAreaBBox = ServiceAreaBBox(
    minLat: 40.640,
    maxLat: 40.885,
    minLng: -74.030,
    maxLng: -73.890
)

/// Starting centroids — ports `constants.ts`'s `NEIGHBORHOOD_CENTROIDS`.
public let neighborhoodCentroids: [Neighborhood: Coords] = [
    // Manhattan
    .fiDi: Coords(lat: 40.7060, lng: -74.0090),
    .les: Coords(lat: 40.7170, lng: -73.9870),
    .eastVillage: Coords(lat: 40.7270, lng: -73.9840),
    .westVillage: Coords(lat: 40.7350, lng: -74.0030),
    .soHo: Coords(lat: 40.7230, lng: -74.0000),
    .chelsea: Coords(lat: 40.7470, lng: -74.0010),
    .midtown: Coords(lat: 40.7550, lng: -73.9840),
    .hellsKitchen: Coords(lat: 40.7630, lng: -73.9920),
    .uws: Coords(lat: 40.7870, lng: -73.9750),
    .ues: Coords(lat: 40.7740, lng: -73.9610),
    .harlem: Coords(lat: 40.8110, lng: -73.9450),
    .tribeca: Coords(lat: 40.7163, lng: -74.0086),
    .batteryParkCity: Coords(lat: 40.7115, lng: -74.0158),
    .hamiltonHeights: Coords(lat: 40.8252, lng: -73.9496),
    .flatiron: Coords(lat: 40.7411, lng: -73.9897),
    .greenwichVillage: Coords(lat: 40.7336, lng: -73.9989),
    .noHo: Coords(lat: 40.7281, lng: -73.9925),
    .hudsonSquare: Coords(lat: 40.7263, lng: -74.0075),
    .gramercy: Coords(lat: 40.7376, lng: -73.9836),
    .kipsBay: Coords(lat: 40.7423, lng: -73.9789),
    .eastHarlem: Coords(lat: 40.7957, lng: -73.9389),
    .morningsideHeights: Coords(lat: 40.809, lng: -73.9613),
    .washingtonHeights: Coords(lat: 40.8417, lng: -73.9394),
    .inwood: Coords(lat: 40.8677, lng: -73.9212),
    .chinatown: Coords(lat: 40.7158, lng: -73.997),
    // Brooklyn
    .williamsburg: Coords(lat: 40.7140, lng: -73.9570),
    .greenpoint: Coords(lat: 40.7300, lng: -73.9510),
    .bushwick: Coords(lat: 40.6940, lng: -73.9210),
    .parkSlope: Coords(lat: 40.6720, lng: -73.9790),
    .fortGreene: Coords(lat: 40.6860, lng: -73.9740),
    .gowanus: Coords(lat: 40.6751, lng: -73.9887),
    // Queens
    .astoria: Coords(lat: 40.7640, lng: -73.9200),
    .lic: Coords(lat: 40.7450, lng: -73.9490),
    .ridgewood: Coords(lat: 40.7043, lng: -73.9018),
]
