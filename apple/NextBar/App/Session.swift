import Foundation
import NextBarCore

/// One search row for the Username-suggestion and Find-friends screens.
public struct HandleSearchResult: Identifiable, Equatable, Sendable {
    public let id: String
    public let handle: String
    public let displayName: String
    public var isFollowing: Bool

    public init(id: String, handle: String, displayName: String, isFollowing: Bool = false) {
        self.id = id
        self.handle = handle
        self.displayName = displayName
        self.isFollowing = isFollowing
    }
}

public enum SessionError: Error, LocalizedError, Equatable {
    case handleTaken
    case network

    public var errorDescription: String? {
        switch self {
        case .handleTaken: return "Taken"
        case .network: return "Something went wrong. Try again."
        }
    }
}

/// Everything a screen needs from the backend, with no Supabase import in
/// this target yet. `PreviewSession` is the only implementation until the
/// plumbing checklist in `docs/SWIFT-PUSH-1-MISSION.md` lands; a later
/// `SupabaseSession` conforms to the same protocol and swaps in at
/// `NextBarApp` with no call-site changes.
///
/// Deliberately NOT `@MainActor`: every call site in this target already
/// runs from a SwiftUI `.task`/button action (the main actor), and keeping
/// the protocol actor-agnostic avoids isolation mismatches at the
/// `EnvironmentKey` default-value boundary (`SessionEnvironment.swift`).
public protocol Session: AnyObject {
    /// The signed-in user's current vibe profile, or an empty one before the
    /// quiz has ever been saved.
    func currentProfile() -> VibeProfile
    func saveProfile(_ profile: VibeProfile) async

    /// Non-mutating check for the Username screen's live typing feedback.
    /// Never reserves the handle — only `claimHandle` does that.
    func isHandleAvailable(_ handle: String) async -> Bool
    /// Throws `.handleTaken` when the handle is already claimed.
    func claimHandle(_ handle: String) async throws
    func searchHandles(_ query: String) async -> [HandleSearchResult]

    func requestMagicLink(email: String) async throws

    /// The fixed catalog this stub serves. A real session pages a live table.
    func bars() async -> [Bar]

    /// Walking/driving estimates keyed by bar id. An id missing from the
    /// result has no known route yet (server error, or a stub with nothing
    /// wired up) — never fabricate a route to fill the gap.
    func travel(
        origin: Coords,
        destinationIDs: [String],
        mode: TravelMode,
        walkableOnly: Bool,
        band: TravelBand
    ) async -> [String: RouteEstimate]
}
