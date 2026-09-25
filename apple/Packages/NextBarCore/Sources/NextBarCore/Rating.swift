import Foundation

/// Ports `src/types/ratings.ts`: `Rating`, `BarRating`, `RATING_ORDER`.
/// Legacy tiers per `CLAUDE.md` — kept only because `tasteAffinity.ts` still
/// reads `BarRating.score`; not the V8 product model.
public enum Rating: String, Codable, Sendable {
    case loved
    case liked
    case pass
}

public struct BarRating: Codable, Equatable, Sendable {
    public var barId: String
    public var rating: Rating
    /// ISO timestamp.
    public var ratedAt: String
    /// 0.0-10.0 personal score; nil until the user has answered at least one
    /// pairwise comparison involving this bar.
    public var score: Double?

    public init(barId: String, rating: Rating, ratedAt: String, score: Double? = nil) {
        self.barId = barId
        self.rating = rating
        self.ratedAt = ratedAt
        self.score = score
    }
}

/// Sort ordering: Loved -> Liked -> Pass, then most-recently-rated first.
public let ratingOrder: [Rating: Int] = [
    .loved: 0,
    .liked: 1,
    .pass: 2,
]
