import SwiftUI

/// Screen 4. Suggestion chips are generic placeholders in this stub — the
/// mission's "derived from display name / email" needs an identity the
/// Apple/Google buttons don't capture yet (no Supabase), so chips are static
/// until that plumbing lands.
struct UsernameView: View {
    let onContinue: (String) -> Void

    private enum Availability: Equatable {
        case idle, checking, available, taken
    }

    @Environment(\.session) private var session
    @State private var handle = ""
    @State private var availability: Availability = .idle
    @State private var isClaiming = false
    @State private var debounceTask: Task<Void, Never>?

    private let suggestions = ["barhopper", "nightowl", "nycregular"]

    private var canContinue: Bool {
        !handle.isEmpty && availability != .taken && availability != .checking && !isClaiming
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            OnboardingProgress(step: 1)

            Text("Pick a username")
                .font(.nb(.semibold, 26))
                .foregroundStyle(NBColor.textPrimary)
                .padding(.horizontal, 24)
                .padding(.top, 16)

            HStack(spacing: 4) {
                Text("@")
                    .font(.nb(.medium, 28))
                    .foregroundStyle(NBColor.textTertiary)
                TextField("username", text: $handle)
                    .font(.nb(.medium, 28))
                    .foregroundStyle(NBColor.textPrimary)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("username.field")

                statusGlyph
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 8)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(NBColor.orange)
                    .frame(height: 2)
                    .padding(.horizontal, 24)
            }
            .onChange(of: handle) { _, newValue in
                scheduleAvailabilityCheck(for: newValue)
            }

            if availability == .taken {
                Text("Taken")
                    .font(.nb(.regular, 13))
                    .foregroundStyle(NBColor.orangeText)
                    .padding(.horizontal, 24)
                    .accessibilityIdentifier("username.takenLabel")
            }

            if !suggestions.isEmpty {
                HStack(spacing: 8) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button(suggestion) {
                            handle = suggestion
                        }
                        .font(.nb(.regular, 13))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(NBColor.card)
                        .foregroundStyle(NBColor.textSecondary)
                        .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, 24)
            }

            Text("Friends find you by this. You can change it later.")
                .font(.nb(.regular, 13))
                .foregroundStyle(NBColor.textTertiary)
                .padding(.horizontal, 24)

            Spacer()

            Button {
                claim()
            } label: {
                Text(isClaiming ? "Checking…" : "Continue")
            }
            .buttonStyle(NBPrimaryButtonStyle(isDisabled: !canContinue))
            .disabled(!canContinue)
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
            .accessibilityIdentifier("username.continue")
        }
        .background(NBColor.base.ignoresSafeArea())
    }

    @ViewBuilder
    private var statusGlyph: some View {
        switch availability {
        case .idle, .checking:
            EmptyView()
        case .available:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .taken:
            Image(systemName: "xmark.circle.fill").foregroundStyle(NBColor.orangeText)
        }
    }

    private func scheduleAvailabilityCheck(for value: String) {
        debounceTask?.cancel()
        guard !value.isEmpty else {
            availability = .idle
            return
        }
        availability = .checking
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            let free = await session.isHandleAvailable(value)
            guard !Task.isCancelled else { return }
            availability = free ? .available : .taken
        }
    }

    private func claim() {
        isClaiming = true
        Task {
            defer { isClaiming = false }
            do {
                try await session.claimHandle(handle)
                onContinue(handle)
            } catch {
                availability = .taken
            }
        }
    }
}
