import SwiftUI
import UIKit

/// Screen 7. Contacts import is out of scope for push 1 — no Contacts
/// permission string exists yet.
struct FindFriendsView: View {
    let onDone: () -> Void

    @Environment(\.session) private var session
    @State private var query = ""
    @State private var results: [HandleSearchResult] = []
    @State private var following: Set<String> = []
    @State private var searchTask: Task<Void, Never>?

    private let shareURL = URL(string: "https://next-bar.com/u/me")!

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                OnboardingProgress(step: 4)
                Spacer()
                Button("Skip") { onDone() }
                    .font(.nb(.regular, 14))
                    .foregroundStyle(NBColor.textSecondary)
                    .padding(.trailing, 24)
                    .accessibilityIdentifier("findFriends.skip")
            }

            Text("Find your friends")
                .font(.nb(.semibold, 26))
                .foregroundStyle(NBColor.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, 16)

            TextField("Search by username", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding()
                .frame(height: 44)
                .background(NBColor.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .foregroundStyle(NBColor.textPrimary)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .accessibilityIdentifier("findFriends.search")
                .onChange(of: query) { _, newValue in scheduleSearch(newValue) }

            List {
                Section {
                    ForEach(results) { result in
                        friendRow(result)
                    }
                }

                Section("Or send friends your link") {
                    ShareLink(item: shareURL) {
                        Label("Share invite link", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        UIPasteboard.general.string = shareURL.absoluteString
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                    } label: {
                        Label("Copy link", systemImage: "link")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)

            Button("Done") { onDone() }
                .buttonStyle(NBPrimaryButtonStyle())
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
                .accessibilityIdentifier("findFriends.done")
        }
        .background(NBColor.base.ignoresSafeArea())
    }

    private func friendRow(_ result: HandleSearchResult) -> some View {
        HStack(spacing: 12) {
            Circle()
                .fill(NBColor.fill)
                .frame(width: 44, height: 44)
                .overlay(
                    Text(result.displayName.prefix(1))
                        .font(.nb(.semibold, 16))
                        .foregroundStyle(NBColor.textPrimary)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(result.displayName).font(.nb(.medium, 15)).foregroundStyle(NBColor.textPrimary)
                Text("@\(result.handle)").font(.nb(.regular, 13)).foregroundStyle(NBColor.textTertiary)
            }

            Spacer()

            let isFollowing = following.contains(result.id)
            Button {
                if isFollowing { following.remove(result.id) } else { following.insert(result.id) }
            } label: {
                Image(systemName: isFollowing ? "checkmark.circle.fill" : "plus.circle")
                    .font(.system(size: 22))
                    .foregroundStyle(isFollowing ? NBColor.orange : NBColor.textSecondary)
            }
            .accessibilityLabel(isFollowing ? "Following \(result.displayName)" : "Follow \(result.displayName)")
            .accessibilityIdentifier("findFriends.follow.\(result.id)")
        }
        .listRowBackground(NBColor.card)
    }

    private func scheduleSearch(_ value: String) {
        searchTask?.cancel()
        guard !value.isEmpty else {
            results = []
            return
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            let found = await session.searchHandles(value)
            guard !Task.isCancelled else { return }
            results = found
        }
    }
}
