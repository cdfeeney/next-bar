import SwiftUI
import UIKit
import NextBarCore

/// One Next Bar? result. `subtitle` is `nil` when the caller has already
/// decided routes are globally unavailable this load — the card then shows
/// no minutes line at all, and the shared "Route times unavailable" banner
/// (`NextBarHomeView`) carries that message once instead of per card.
struct ResultCardView: View {
    let rank: Int
    let bar: Bar
    let subtitle: String?

    @State private var showingDetails = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .bottomLeading) {
                Rectangle()
                    .fill(heroTint)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay(
                        Text(String(bar.name.prefix(1)))
                            .font(.nb(.semibold, 40))
                            .foregroundStyle(NBColor.textPrimary.opacity(0.5))
                    )
                LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom)

                VStack(alignment: .leading, spacing: 2) {
                    Text("\(rank). \(bar.name)")
                        .font(.nb(.semibold, 18))
                        .foregroundStyle(.white)
                    Text("\(bar.neighborhood.rawValue.uppercased()) \u{00B7} \(priceDollarSigns)")
                        .font(.nb(.regular, 13))
                        .foregroundStyle(.white.opacity(0.85))
                }
                .padding(12)
            }
            .clipShape(RoundedRectangle(cornerRadius: 16))

            if let subtitle {
                HStack(spacing: 6) {
                    Circle().fill(NBColor.orange).frame(width: 6, height: 6)
                    Text(subtitle)
                        .font(.nb(.regular, 13))
                        .foregroundStyle(NBColor.textSecondary)
                }
            }

            Button("Photos & hours") { showingDetails = true }
                .font(.nb(.regular, 14))
                .foregroundStyle(NBColor.orangeText)
                .accessibilityIdentifier("home.card.\(rank).photosAndHours")
        }
        .padding(12)
        .background(NBColor.card)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        // `.contain` keeps "Photos & hours" individually tappable while also
        // exposing the card itself as one element XCUITest can look up by
        // rank — a plain container view with no accessibility modifier is
        // otherwise invisible to `app.otherElements[...]`.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.card.\(rank)")
        .sheet(isPresented: $showingDetails) {
            BarDetailsSheet(bar: bar)
        }
    }

    /// A stable, deterministic tint from the bar id — there is no Places
    /// photo in this stub (Places UI Kit is NB-03's own push). `hashValue` is
    /// randomized per process launch, so it's a sum of unicode scalars
    /// instead: the same bar gets the same tint across every run.
    private var heroTint: Color {
        let palette: [Color] = [NBColor.raised, NBColor.fill, NBColor.selected]
        let sum = bar.id.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return palette[sum % palette.count]
    }

    private var priceDollarSigns: String {
        String(repeating: "$", count: max(1, min(bar.priceTier, 4)))
    }
}

/// The "Photos & hours" sheet. No Places UI Kit yet (decision 3, NB-03) — the
/// hero placeholder repeats here, and hours render only when the stub bar
/// happens to carry them.
private struct BarDetailsSheet: View {
    let bar: Bar
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(NBColor.fill)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .overlay(
                            Text(String(bar.name.prefix(1)))
                                .font(.nb(.semibold, 48))
                                .foregroundStyle(NBColor.textPrimary.opacity(0.5))
                        )

                    Text(bar.blurb)
                        .font(.nb(.regular, 15))
                        .foregroundStyle(NBColor.textSecondary)

                    if bar.hours == nil {
                        Text("Hours unavailable")
                            .font(.nb(.regular, 13))
                            .foregroundStyle(NBColor.textTertiary)
                    }

                    Button("Open in Maps") {
                        let href = directionsHref(origin: nil, destination: bar.coords, mode: .walking)
                        if let url = URL(string: href) {
                            UIApplication.shared.open(url)
                        }
                    }
                    .buttonStyle(NBOutlineButtonStyle())
                }
                .padding(24)
            }
            .background(NBColor.base.ignoresSafeArea())
            .navigationTitle(bar.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
