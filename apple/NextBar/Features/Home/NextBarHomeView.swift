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

    @Environment(\.session) private var session
    @State private var phase: Phase = .checkingRoutes
    @State private var band: DistanceBandChoice = .walkable
    @State private var profile = VibeProfile(tags: [], archetype: deriveArchetype([]), preferredNeighborhoods: [])
    @State private var showingTweakVibe = false
    @State private var isPulsing = false

    // TODO(NB-plumbing): a fixed West Village stand-in until CoreLocation's
    // fix from screen 5 is threaded down to Home — see LocationPrimerView.
    private let origin = PreviewSession.previewOrigin

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    DistanceChips(selection: $band)
                        .padding(.horizontal, 24)
                    Text("Near you \u{00B7} West Village")
                        .font(.nb(.regular, 13))
                        .foregroundStyle(NBColor.textTertiary)
                        .padding(.horizontal, 24)

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
                LazyVStack(spacing: 16) {
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
                .font(.nb(.semibold, 22))
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
        let bounds = band.milesBounds

        let ranked = matches(MatchesArgs(
            profile: currentProfile,
            coords: origin,
            preferredNeighborhoods: currentProfile.preferredNeighborhoods,
            minMilesExclusive: bounds.min,
            maxMiles: bounds.max,
            distanceBands: false,
            bars: allBars,
            maxResults: resultsCount
        ))

        let routes = await session.travel(
            origin: origin,
            destinationIDs: ranked.map(\.id),
            mode: .walking,
            walkableOnly: false,
            band: band.coreBand
        )
        let routesAvailable = routes.values.contains { isRouteEstimate($0) }
        phase = .ready(bars: ranked, routes: routes, routesAvailable: routesAvailable)
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
