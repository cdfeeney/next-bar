import SwiftUI
import AuthenticationServices

/// Screen 2. No phone button (decision 4 — deferred to push 4). Apple and
/// Google are treated as instant sign-up in this stub (no Supabase yet), so
/// they skip straight to Username; the email path goes through Check inbox
/// first, matching the real magic-link flow it will call into.
struct CreateAccountView: View {
    let prefillEmail: String
    let onAuthenticated: () -> Void
    let onEmailLinkSent: (String) -> Void

    @Environment(\.session) private var session
    @State private var email: String
    @State private var emailError: String?
    @State private var isSending = false
    @State private var safariURL: URL?

    init(prefillEmail: String, onAuthenticated: @escaping () -> Void, onEmailLinkSent: @escaping (String) -> Void) {
        self.prefillEmail = prefillEmail
        self.onAuthenticated = onAuthenticated
        self.onEmailLinkSent = onEmailLinkSent
        _email = State(initialValue: prefillEmail)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Text("Create your account")
                    .font(.nb(.semibold, 26))
                    .foregroundStyle(NBColor.textPrimary)
                    .padding(.top, 48)
                    .padding(.bottom, 8)

                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.email]
                } onCompletion: { result in
                    if case .success = result { onAuthenticated() }
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 50)
                .cornerRadius(25)
                .accessibilityIdentifier("createAccount.continueWithApple")

                Button {
                    onAuthenticated()
                } label: {
                    Label("Continue with Google", systemImage: "g.circle")
                }
                .buttonStyle(NBOutlineButtonStyle())
                .accessibilityIdentifier("createAccount.continueWithGoogle")

                HStack {
                    divider
                    Text("or").font(.nb(.regular, 13)).foregroundStyle(NBColor.textTertiary)
                    divider
                }
                .padding(.vertical, 4)

                VStack(alignment: .leading, spacing: 6) {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding()
                        .frame(height: 50)
                        .background(NBColor.card)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(NBColor.textPrimary)
                        .accessibilityIdentifier("createAccount.emailField")

                    if let emailError {
                        Text(emailError)
                            .font(.nb(.regular, 13))
                            .foregroundStyle(NBColor.orangeText)
                            .accessibilityIdentifier("createAccount.emailError")
                    }
                }

                Button {
                    submitEmail()
                } label: {
                    Text(isSending ? "Sending…" : "Continue with email")
                }
                .buttonStyle(NBPrimaryButtonStyle(isDisabled: email.isEmpty))
                .disabled(email.isEmpty || isSending)
                .accessibilityIdentifier("createAccount.continueWithEmail")

                legalFooter
                    .padding(.top, 8)

                Button("Have an account? Sign in") {
                    // Push 1 has no returning-user path yet; sign-in reuses
                    // the same email flow.
                }
                .font(.nb(.regular, 14))
                .foregroundStyle(NBColor.textSecondary)
                .padding(.top, 4)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(NBColor.base.ignoresSafeArea())
        .sheet(item: Binding(get: { safariURL.map(IdentifiableURL.init) }, set: { safariURL = $0?.url })) { wrapped in
            SafariView(url: wrapped.url)
        }
    }

    private var divider: some View {
        Rectangle().fill(NBColor.fill).frame(height: 1)
    }

    private var legalFooter: some View {
        HStack(spacing: 4) {
            Text("By continuing you agree to the")
                .font(.nb(.regular, 12))
                .foregroundStyle(NBColor.textTertiary)
            Button("Terms") { safariURL = URL(string: "https://next-bar.com/terms") }
                .font(.nb(.regular, 12))
            Text("and").font(.nb(.regular, 12)).foregroundStyle(NBColor.textTertiary)
            Button("Privacy Policy.") { safariURL = URL(string: "https://next-bar.com/privacy") }
                .font(.nb(.regular, 12))
        }
        .multilineTextAlignment(.center)
    }

    private func submitEmail() {
        guard isValidEmail(email) else {
            emailError = "Enter a valid email address."
            return
        }
        emailError = nil
        isSending = true
        Task {
            defer { isSending = false }
            do {
                try await session.requestMagicLink(email: email)
                onEmailLinkSent(email)
            } catch {
                emailError = "Something went wrong. Try again."
            }
        }
    }
}

/// A loose but real check — rejects "missing @" / "missing domain dot"
/// without pulling in a regex dependency for one screen.
private func isValidEmail(_ email: String) -> Bool {
    guard let atIndex = email.firstIndex(of: "@") else { return false }
    let domain = email[email.index(after: atIndex)...]
    return !email[..<atIndex].isEmpty && domain.contains(".") && !domain.hasSuffix(".")
}

private struct IdentifiableURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
