import SwiftUI
import CoreLocation

/// Screen 5, copy ported verbatim from the web primer
/// (`src/app/onboarding/location/page.tsx`). Push 1's iOS screen is the
/// two-button version from the mission spec — the web's third "Choose a
/// neighborhood" branch is Next Bar? home's job (screen 8) when there is no
/// fix, not this screen's.
///
/// Whether the permission is granted or denied, the flow always continues to
/// the quiz next — this screen only ever asks once.
struct LocationPrimerView: View {
    let onContinue: () -> Void

    @StateObject private var locationRequester = LocationPermissionRequester()

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle().fill(NBColor.raised).frame(width: 88, height: 88)
                Image(systemName: "location.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(NBColor.orangeText)
            }

            Text("So we can find bars near you tonight")
                .font(.nb(.semibold, 24))
                .multilineTextAlignment(.center)
                .foregroundStyle(NBColor.textPrimary)
                .padding(.horizontal, 32)

            Text("Location powers your five recommendations. You can change this anytime in Settings.")
                .font(.nb(.regular, 15))
                .multilineTextAlignment(.center)
                .foregroundStyle(NBColor.textSecondary)
                .padding(.horizontal, 32)

            Spacer()

            VStack(spacing: 12) {
                Button("Share my location") {
                    locationRequester.request(onDecided: onContinue)
                }
                .buttonStyle(NBPrimaryButtonStyle())
                .accessibilityIdentifier("locationPrimer.share")

                Button("Not now") {
                    onContinue()
                }
                .font(.nb(.regular, 14))
                .foregroundStyle(NBColor.textSecondary)
                .accessibilityIdentifier("locationPrimer.notNow")
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(NBColor.base.ignoresSafeArea())
    }
}

/// Wraps `CLLocationManager`'s permission callback as a one-shot async-style
/// call. Granted or denied, `onDecided` fires exactly once.
private final class LocationPermissionRequester: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var onDecided: (() -> Void)?

    func request(onDecided: @escaping () -> Void) {
        guard manager.authorizationStatus == .notDetermined else {
            onDecided()
            return
        }
        self.onDecided = onDecided
        manager.delegate = self
        manager.requestWhenInUseAuthorization()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let decide = onDecided
        onDecided = nil
        decide?()
    }
}
