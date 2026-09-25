import SwiftUI

/// The 4-segment "Username · Location · Quiz · Friends" progress bar shown
/// at the top of screens 4-7. `step` is 1-based.
struct OnboardingProgress: View {
    let step: Int
    private let total = 4

    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...total, id: \.self) { index in
                Capsule()
                    .fill(index <= step ? NBColor.orange : NBColor.fill)
                    .frame(height: 4)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .accessibilityIdentifier("onboarding.progress")
        .accessibilityValue("Step \(step) of \(total)")
    }
}
