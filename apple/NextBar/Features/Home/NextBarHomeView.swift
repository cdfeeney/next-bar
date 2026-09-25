import SwiftUI
import NextBarCore

/// Screen 8. Content-first: ranking runs in `NextBarCore.Matching`, walk
/// times come from `Session.travel`. The loading contract (ported from the
/// 2026-09-24 web bug fix): three pulsing placeholders + "Checking street
/// routes…" while routes are pending, never an empty-state sentence; on
/// failure the real cards render without minutes plus one "Route times
/// unavailable" line.
struct NextBarHomeView: View {
    private enum Phase {
        case checkingRoutes
        case ready(bars: [Bar], routes: [String: RouteEstimate], routesAvailable: Bool)
    }

    /// Real coordinates from screen 5's location primer, or `nil` when
    /// permission was denied/"Not now" — `nil` opens the neighborhood picker
    /// instead of "Near you" results (spec, screen 8).
    let homeCoords: Coords?

    @Environment(\.session) private var session
    @State private var phase: Phase = .checkingRoutes
    @State private var band: DistanceBandChoice = .walkable
    @State private var profile = VibeProfile(tags: [], archetype: deriveArchetype([]), preferredNeighborhoods: [])
    @State private var showingTweakVibe = false
    @State private var isPulsing = false
    @State private var pickedNeighborhood: Neighborhood?

    var body: some View {
        NavigationStack {
            if homeCoords == nil, pickedNeighborhood == nil {
                neighborhoodPicker
            } else {
                results
            }
        }
    }

    private var results: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if homeCoords != nil {
                    DistanceChips(selection: $band)
                        .padding(.horizontal, 24)
                    Text(locationLabel)
                        .font(.nb(.regular, 13))
                        .foregroundStyle(NBColor.textTertiary)
                        .padding(.horizontal, 24)
                } else if let pickedNeighborhood {
                    Text(pickedNeighborhood.rawValue)
                        .font(.nb(.regular, 13))
                        .foregroundStyle(NBColor.textTertiary)
                        .padding(.horizontal, 24)
                }

                content
            }
            .padding(.vertical, 16)
        }
        .background(NBColor.base.ignoresSafeArea())
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: band) { _, _ in Task { await load() } }
        .sheet(isPresented: $showingTweakVibe) {
            TweakVibeSheet(selectedTags: Set(profile.tags)) { tags in
                Task { await applyTweak(tags) }
            }
        }
    }

    /// Shown when there is no location fix at all (denied/"Not now" and no
    /// neighborhood chosen yet) — the web's neighborhood-picker fallback,
    /// never a permission wall.
    private var neighborhoodPicker: some View {
        List(Neighborhood.allCases, id: \.self) { neighborhood in
            Button(neighborhood.rawValue) {
                pickedNeighborhood = neighborhood
            }
            .accessibilityIdentifier("home.neighborhood.\(neighborhood.rawValue)")
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(NBColor.base.ignoresSafeArea())
        .navigationTitle("Pick a neighborhood")
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .checkingRoutes:
            loadingPlaceholders
        case .ready(let bars, let routes, let routesAvailable):
            VStack(alignment: .leading, spacing: 16) {
                if !routesAvailable {
                    Text("Route times unavailable")
                        .font(.nb(.regular, 13))
                        .foregroundStyle(NBColor.textTertiary)
                        .accessibilityIdentifier("home.routesUnavailable")
                }
                // Plain VStack, not LazyVStack: with only 5 results, laziness
                // buys nothing and costs ranks 4-5 their place in the
                // accessibility tree until scrolled into view (XCUITest
                // queries the whole tree up front).
                VStack(spacing: 16) {
                    ForEach(Array(bars.enumerated()), id: \.element.id) { offset, bar in
                        ResultCardView(
                            rank: offset + 1,
                            bar: bar,
                            subtitle: routesAvailable ? routeCopy(routes[bar.id], mode: .walking) : nil
                        )
                    }
                }
            }
            .padding(.horizontal, 24)
        }
    }

    private var header: some View {
        HStack {
            Text("Next Bar?")
                .font(.nb(.bold, 22))
                .foregroundStyle(NBColor.textPrimary)
            Spacer()
            Button {
                showingTweakVibe = true
            } label: {
                Label("Tweak the vibe", systemImage: "slider.horizontal.3")
            }
            .font(.nb(.regular, 13))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(NBColor.card)
            .foregroundStyle(NBColor.textPrimary)
            .clipShape(Capsule())
            .accessibilityIdentifier("home.tweakVibe")
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
    }

    private var loadingPlaceholders: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 16)
                    .fill(NBColor.card)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .opacity(isPulsing ? 0.5 : 1)
                    .accessibilityElement()
                    .accessibilityIdentifier("home.placeholder")
            }
            Text("Checking street routes\u{2026}")
                .font(.nb(.regular, 13))
                .foregroundStyle(NBColor.textSecondary)
                .accessibilityIdentifier("home.checkingRoutes")
        }
        .padding(.horizontal, 24)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                isPulsing = true
            }
        }
    }

    private func load() async {
        phase = .checkingRoutes
        let currentProfile = session.currentProfile()
        profile = currentProfile
        let allBars = await session.bars()

        // With a real fix, rank by the quiz's preferred neighborhoods as
        // usual and band by distance. Without one, there is no origin to
        // band on — rank within the picked neighborhood alone instead
        // (spec: "ranks with location: .neighborhood").
        let origin = homeCoords
        let preferredNeighborhoods = origin != nil
            ? currentProfile.preferredNeighborhoods
            : pickedNeighborhood.map { [$0] } ?? []
        let bounds: (min: Double?, max: Double?) = origin != nil ? band.milesBounds : (nil, nil)

        let ranked = matches(MatchesArgs(
            profile: currentProfile,
            coords: origin,
            preferredNeighborhoods: preferredNeighborhoods,
            minMilesExclusive: bounds.min,
            maxMiles: bounds.max,
            distanceBands: false,
            bars: allBars,
            maxResults: resultsCount
        ))

        guard let origin else {
            // No coordinates at all: nothing to route from, so this is the
            // "Route times unavailable" case by definition, not a timeout.
            phase = .ready(bars: ranked, routes: [:], routesAvailable: false)
            return
        }

        let routes = await Self.travel(
            session: session,
            origin: origin,
            destinationIDs: ranked.map(\.id),
            band: band.coreBand
        )
        let routesAvailable = routes?.values.contains { isRouteEstimate($0) } ?? false
        phase = .ready(bars: ranked, routes: routes ?? [:], routesAvailable: routesAvailable)
    }

    /// "Near you · {neighborhood}" when the fix snaps to a centroid within
    /// `maxSnapMiles` (same rule as the web's `snappedNeighborhood`), else
    /// plain "Near you" — never a hardcoded name (Codex, 2026-09-25).
    private var locationLabel: String {
        guard let homeCoords else { return "Near you" }
        let nearest = neighborhoodCentroids.min {
            haversineMiles(homeCoords, $0.value) < haversineMiles(homeCoords, $1.value)
        }
        if let nearest, haversineMiles(homeCoords, nearest.value) <= maxSnapMiles {
            return "Near you \u{00B7} \(nearest.key.rawValue)"
        }
        return "Near you"
    }

    /// Races `Session.travel` against a 10s deadline (spec, screen 8). A
    /// task group would still wait for a child that ignores cancellation, so
    /// this resumes a continuation exactly once — whichever side finishes
    /// first — and cancels the loser (Codex, 2026-09-25).
    private static func travel(
        session: any Session,
        origin: Coords,
        destinationIDs: [String],
        band: TravelBand
    ) async -> [String: RouteEstimate]? {
        let once = ResumeOnce()
        return await withCheckedContinuation { continuation in
            let work = Task {
                let routes = await session.travel(origin: origin, destinationIDs: destinationIDs, mode: .walking, walkableOnly: false, band: band)
                if await once.claim() { continuation.resume(returning: routes) }
            }
            Task {
                try? await Task.sleep(for: .seconds(10))
                if await once.claim() {
                    work.cancel()
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private func applyTweak(_ tags: [VibeTag]) async {
        let updated = VibeProfile(
            tags: tags,
            archetype: profile.archetype,
            preferredNeighborhoods: profile.preferredNeighborhoods,
            isExplicitVibe: true
        )
        await session.saveProfile(updated)
        profile = updated
        await load()
    }
}

/// First caller wins; every later `claim()` is false. Keeps the travel
/// continuation from resuming twice.
private actor ResumeOnce {
    private var claimed = false
    func claim() -> Bool {
        if claimed { return false }
        claimed = true
        return true
    }
}
