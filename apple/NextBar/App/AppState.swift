import Foundation
import NextBarCore

/// Top-level "which flow is the user in" switch. Push 1 has exactly two
/// states: the onboarding chain, or the signed-in tab shell. A real session
/// restores `isSignedIn` from a stored auth token at launch; the stub always
/// starts signed out, matching decision "signed-out launch goes to Create
/// account, not to a tab."
@MainActor
final class AppState: ObservableObject {
    @Published var isSignedIn = false

    /// Set once by `LocationPrimerView` during onboarding: real coordinates
    /// when permission was granted, or `nil` when denied/"Not now" — `nil`
    /// means Next Bar? home opens on the neighborhood picker instead of
    /// "Near you" results.
    @Published var homeCoords: Coords?

    /// `homeCoords`, stubbed for XCUITest determinism: plain `-uiTesting`
    /// always resolves to a location (so existing flows that deny it in the
    /// primer still reach ranked results), while `-uiTestingNoLocation`
    /// forces the neighborhood-picker path regardless of what the primer did.
    var effectiveHomeCoords: Coords? {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-uiTestingNoLocation") { return nil }
        if arguments.contains("-uiTesting") { return homeCoords ?? PreviewSession.previewOrigin }
        return homeCoords
    }
}
