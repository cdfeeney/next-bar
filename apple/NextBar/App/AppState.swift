import Foundation

/// Top-level "which flow is the user in" switch. Push 1 has exactly two
/// states: the onboarding chain, or the signed-in tab shell. A real session
/// restores `isSignedIn` from a stored auth token at launch; the stub always
/// starts signed out, matching decision "signed-out launch goes to Create
/// account, not to a tab."
@MainActor
final class AppState: ObservableObject {
    @Published var isSignedIn = false
}
