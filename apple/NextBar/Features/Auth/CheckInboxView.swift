import SwiftUI
import UIKit
import Combine

/// Screen 3. The magic link opens the app via the universal link once the
/// AASA file is live (plumbing checklist); until then it lands on the web
/// callback, so "Open Mail" here also advances the stub flow directly —
/// acceptable for the first runner build, not for testers (spec, screen 3).
struct CheckInboxView: View {
    let email: String
    let onContinue: () -> Void
    let onChangeEmail: () -> Void

    @Environment(\.session) private var session
    @State private var resendCooldown = 0
    private let resendWindow = 30
    private let mailURL = URL(string: "message://")!
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            ZStack {
                Circle().fill(NBColor.raised).frame(width: 88, height: 88)
                Image(systemName: "envelope")
                    .font(.system(size: 32))
                    .foregroundStyle(NBColor.orangeText)
            }

            Text("Check your inbox")
                .font(.nb(.semibold, 24))
                .foregroundStyle(NBColor.textPrimary)

            Text("We sent a link to \(email). Tap it to finish signing up.")
                .font(.nb(.regular, 15))
                .foregroundStyle(NBColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Spacer()

            VStack(spacing: 12) {
                if UIApplication.shared.canOpenURL(mailURL) {
                    Button("Open Mail") {
                        UIApplication.shared.open(mailURL)
                        onContinue()
                    }
                    .buttonStyle(NBPrimaryButtonStyle())
                    .accessibilityIdentifier("checkInbox.openMail")
                }

                Button {
                    resend()
                } label: {
                    Text(resendCooldown > 0 ? "Resend email (\(resendCooldown)s)" : "Resend email")
                }
                .buttonStyle(NBOutlineButtonStyle())
                .disabled(resendCooldown > 0)
                .accessibilityIdentifier("checkInbox.resend")

                Button("Wrong email? Change it") {
                    onChangeEmail()
                }
                .font(.nb(.regular, 14))
                .foregroundStyle(NBColor.textSecondary)
                .accessibilityIdentifier("checkInbox.changeEmail")
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(NBColor.base.ignoresSafeArea())
        .onReceive(timer) { _ in
            if resendCooldown > 0 { resendCooldown -= 1 }
        }
        .onAppear { resendCooldown = resendWindow }
    }

    private func resend() {
        Task {
            try? await session.requestMagicLink(email: email)
            resendCooldown = resendWindow
        }
    }
}
