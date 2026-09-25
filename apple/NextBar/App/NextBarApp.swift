import SwiftUI
import UIKit

@main
struct NextBarApp: App {
    @StateObject private var appState = AppState()
    private let session: any Session = PreviewSession()

    init() {
        // XCUITests launch with this argument; PreviewSession is already the
        // only Session, so the one thing left to make deterministic is
        // animation timing, which otherwise makes screenshot timing flaky.
        if ProcessInfo.processInfo.arguments.contains("-uiTesting") {
            UIView.setAnimationsEnabled(false)
        }
    }

    var body: some Scene {
        WindowGroup {
            RootRouter()
                .environmentObject(appState)
                .environment(\.session, session)
                .preferredColorScheme(.dark)
        }
    }
}

/// Signed-out launch goes to Create account, never to a tab (decision in
/// `docs/SWIFT-PUSH-1-MISSION.md`).
struct RootRouter: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Group {
            if appState.isSignedIn {
                MainTabView()
            } else {
                OnboardingFlow()
            }
        }
        .tint(NBColor.orange)
    }
}
