import SwiftUI
import NextBarCore

/// The Walkable · Worth a cab · Anywhere segmented control (screen 8). Maps
/// straight onto `NextBarCore`'s existing distance constants — no new bands
/// invented here.
enum DistanceBandChoice: String, CaseIterable, Identifiable {
    case walkable = "Walkable"
    case cab = "Worth a cab"
    case anywhere = "Anywhere"

    var id: String { rawValue }

    /// Fed straight to `MatchesArgs.minMilesExclusive`/`maxMiles`.
    var milesBounds: (min: Double?, max: Double?) {
        switch self {
        case .walkable: return (nil, radiusWalk)
        case .cab: return (radiusWalk, radiusCab)
        case .anywhere: return (radiusCab, nil)
        }
    }

    var coreBand: TravelBand {
        switch self {
        case .walkable: return .walkable
        case .cab: return .cab
        case .anywhere: return .anywhere
        }
    }
}

struct DistanceChips: View {
    @Binding var selection: DistanceBandChoice

    var body: some View {
        Picker("Distance", selection: $selection) {
            ForEach(DistanceBandChoice.allCases) { choice in
                Text(choice.rawValue).tag(choice)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("home.distancePicker")
        .sensoryFeedback(.selection, trigger: selection)
    }
}
