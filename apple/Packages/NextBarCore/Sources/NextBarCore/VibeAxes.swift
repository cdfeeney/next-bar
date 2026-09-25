import Foundation

/// Ports `src/lib/vibeAxes.ts` — the tag vocabulary grouped into 6 named axes.
/// A tag lives in EXACTLY one axis (enforced by `VibeAxesTests`, the port of
/// `vibeAxes.test.ts`, against `VibeTag.allCases`).
public enum VibeAxis: String, CaseIterable, Sendable {
    case drink = "Drink"
    case energy = "Energy"
    case setting = "Setting"
    case scene = "Scene"
    case sound = "Sound"
    case spend = "Spend"
}

/// Display order for the E2.2 axis cards.
public let axisOrder: [VibeAxis] = [.drink, .energy, .setting, .scene, .sound, .spend]

public let vibeAxes: [VibeAxis: [VibeTag]] = [
    .drink: [.cocktail, .wine, .beer],
    .energy: [.chill, .buzzy, .loud, .dance],
    .setting: [.dive, .lounge, .speakeasy, .pub, .rooftop, .garden, .club, .restaurantBar],
    .scene: [
        .locals, .postWork, .date, .tourist, .industry, .romantic, .trendy,
        .indie, .oldNyc, .rough, .polished, .instagrammable,
    ],
    .sound: [.hiphop, .house, .jazz, .live],
    .spend: [.cheap, .mid, .pricey, .splurge],
]

private let tagToAxis: [VibeTag: VibeAxis] = {
    var map: [VibeTag: VibeAxis] = [:]
    for axis in axisOrder {
        for tag in vibeAxes[axis] ?? [] {
            map[tag] = axis
        }
    }
    return map
}()

/// The axis a tag belongs to. Ports `axisOf` (a "total function over the
/// vocabulary" per the TS doc comment); TS throws on an unhomed tag, Swift
/// crashes with `fatalError` since there is no caller that should ever pass
/// one (deliberate divergence — see PARITY.md).
public func axisOf(_ tag: VibeTag) -> VibeAxis {
    guard let axis = tagToAxis[tag] else {
        fatalError("vibeAxes: unhomed tag \(tag.rawValue)")
    }
    return axis
}
