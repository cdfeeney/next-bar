import SwiftUI

/// Screen 1: the five-tab shell. Push 1 ships real content only on Next
/// Bar?; the other four show a title and a one-line "coming in the next
/// build" body, never a blank view.
struct MainTabView: View {
    var body: some View {
        TabView {
            NextBarHomeView()
                .tabItem { Label("Next Bar?", systemImage: "house") }
                .accessibilityIdentifier("tab.nextBar")

            ComingSoonView(title: "Map", systemImage: "mappin.and.ellipse")
                .tabItem { Label("Map", systemImage: "mappin.and.ellipse") }
                .accessibilityIdentifier("tab.map")

            ComingSoonView(title: "Rankings", systemImage: "list.bullet")
                .tabItem { Label("Rankings", systemImage: "list.bullet") }
                .accessibilityIdentifier("tab.rankings")

            ComingSoonView(title: "Tonight", systemImage: "person.2")
                .tabItem { Label("Tonight", systemImage: "person.2") }
                .accessibilityIdentifier("tab.tonight")

            ComingSoonView(title: "Account", systemImage: "person")
                .tabItem { Label("Account", systemImage: "person") }
                .accessibilityIdentifier("tab.account")
        }
        .background(NBColor.base)
    }
}

/// Shared placeholder for the four tabs push 1 doesn't build content for.
struct ComingSoonView: View {
    let title: String
    let systemImage: String

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 40))
                    .foregroundStyle(NBColor.textTertiary)
                Text("Coming in the next build")
                    .font(.nb(.regular, 15))
                    .foregroundStyle(NBColor.textSecondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(NBColor.base)
            .navigationTitle(title)
        }
    }
}
