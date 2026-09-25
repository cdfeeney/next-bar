import SwiftUI
import CoreLocation
import NextBarCore

/// Screen 5, copy ported verbatim from the web primer
/// (`src/app/onboarding/location/page.tsx`). Push 1's iOS screen is the
/// two-button version from the mission spec — the web's third "Choose a
/// neighborhood" branch is Next Bar? home's job (screen 8) when there is no
/// fix, not this screen's.
///
/// Whether the permission is granted or denied, the flow always continues to
/// the quiz next — this screen only ever asks once. `onContinue` carries the
/// resolved coordinates when permission was granted, or `nil` when denied /
/// "Not now"; the caller threads that into Next Bar? home.
struct LocationPrimerView: View {
    let onContinue: (Coords?) -> Void

    @StateObject private var locationRequester = LocationPermissionRequester()

    var body: some View {
        VStack(spacing: 24) {
            OnboardingProgress(step: 2)

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
                    onContinue(nil)
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

/// Wraps `CLLocationManager`'s permission + location callbacks as a one-shot
/// async-style call. Granted or denied, `onDecided` fires exactly once, with
/// real coordinates on a grant or `nil` on a denial/failure. `.notDetermined`
/// is the system alert still being answered — it must never advance the flow
/// on its own.
private final class LocationPermissionRequester: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var onDecided: ((Coords?) -> Void)?

    func request(onDecided: @escaping (Coords?) -> Void) {
        self.onDecided = onDecided
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.delegate = self
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.delegate = self
            manager.requestLocation()
        default:
            finish(nil)
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .notDetermined:
            return // still pending the system alert; do not advance
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        default:
            finish(nil)
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        finish(locations.last.map { Coords(lat: $0.coordinate.latitude, lng: $0.coordinate.longitude) })
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(nil)
    }

    private func finish(_ coords: Coords?) {
        let decide = onDecided
        onDecided = nil
        decide?(coords)
    }
}
