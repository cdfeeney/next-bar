import SwiftUI

/// The pushed destinations after Create account. `checkInbox` and `username`
/// carry the state the next screen needs; the rest read from the coordinator.
enum OnboardingStep: Hashable {
    case checkInbox(email: String)
    case username
    case locationPrimer
    case quiz
    case findFriends
}

/// Screens 2-7 in one `NavigationStack`. Tab bar is hidden for all of it
/// (there is no tab bar to hide — `RootRouter` only shows `MainTabView`
/// after `AppState.isSignedIn` flips, which happens at the end of
/// `FindFriendsView`).
struct OnboardingFlow: View {
    @State private var path: [OnboardingStep] = []
    @State private var prefillEmail = ""
    @State private var claimedHandle: String?
    @EnvironmentObject private var appState: AppState
    @Environment(\.session) private var session

    var body: some View {
        NavigationStack(path: $path) {
            CreateAccountView(
                prefillEmail: prefillEmail,
                onAuthenticated: { path.append(.username) },
                onEmailLinkSent: { email in
                    prefillEmail = email
                    path.append(.checkInbox(email: email))
                }
            )
            // Forces a fresh `@State` inside CreateAccountView whenever the
            // prefill changes (e.g. "Change it" from Check inbox) — SwiftUI
            // otherwise keeps the already-materialized view's stale `@State`
            // across a plain property update.
            .id(prefillEmail)
            .navigationDestination(for: OnboardingStep.self) { step in
                switch step {
                case .checkInbox(let email):
                    CheckInboxView(
                        email: email,
                        onContinue: { path.append(.username) },
                        onChangeEmail: { path.removeLast() }
                    )
                case .username:
                    UsernameView(onContinue: { handle in
                        claimedHandle = handle
                        path.append(.locationPrimer)
                    })
                case .locationPrimer:
                    LocationPrimerView(onContinue: { coords in
                        appState.homeCoords = coords
                        path.append(.quiz)
                    })
                case .quiz:
                    QuizView(
                        onFinished: { profile in
                            Task {
                                await session.saveProfile(profile)
                                path.append(.findFriends)
                            }
                        },
                        onBack: { path.removeLast() }
                    )
                case .findFriends:
                    FindFriendsView(handle: claimedHandle, onDone: { appState.isSignedIn = true })
                }
            }
        }
    }
}
