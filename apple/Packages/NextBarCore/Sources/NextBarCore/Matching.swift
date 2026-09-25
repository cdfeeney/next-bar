import Foundation

/// Ports `src/lib/matching.ts` — the ranker.

public func jaccard(_ a: [VibeTag], _ b: [VibeTag]) -> Double {
    if a.isEmpty && b.isEmpty { return 0 }
    let setA = Set(a)
    let setB = Set(b)
    let intersection = setA.intersection(setB).count
    let union = setA.count + setB.count - intersection
    if union == 0 { return 0 }
    return Double(intersection) / Double(union)
}

/// The vibes the user EXPLICITLY selected, deduplicated — or nil when no
/// selection is active (V8-R-NXT-009 / D-C-41). A saved quiz profile is a
/// cold-start prior, not a choice the user just made, so it never reaches
/// here. Only an APPLIED Tweak-the-vibe pick sets `isExplicitVibe`, and an
/// applied EMPTY pick is a CLEAR — it returns nil.
public func selectedVibes(_ profile: VibeProfile) -> [VibeTag]? {
    guard profile.isExplicitVibe == true else { return nil }
    var seen = Set<VibeTag>()
    var unique: [VibeTag] = []
    for tag in profile.tags where !seen.contains(tag) {
        seen.insert(tag)
        unique.append(tag)
    }
    return unique.isEmpty ? nil : unique
}

/// How many of the SELECTED vibes a bar carries. Both sides deduplicated.
public func vibeMatchCount(_ selected: [VibeTag], _ barTags: [VibeTag]) -> Int {
    let bar = Set(barTags)
    var num = 0
    for tag in Set(selected) where bar.contains(tag) { num += 1 }
    return num
}

/// ELIGIBILITY (V8-R-NXT-009 / D-C-41): with N distinct selected vibes a bar
/// must carry at least max(1, N - 1) of them — one miss is forgiven. With NO
/// selection this gates nothing.
public func isVibeEligible(_ selected: [VibeTag], _ barTags: [VibeTag]) -> Bool {
    let den = Set(selected).count
    if den == 0 { return true }
    return vibeMatchCount(selected, barTags) >= max(1, den - 1)
}

/// The match badge, or nil when there is nothing honest to show. The
/// denominator is N — the number of vibes the user actually picked — never
/// `min(|user|, |bar|)`.
public struct VibeMatchBadge: Equatable, Sendable {
    public let num: Int
    public let den: Int
}

public func vibeMatchBadge(_ selected: [VibeTag], _ barTags: [VibeTag]) -> VibeMatchBadge? {
    let den = Set(selected).count
    if den == 0 { return nil }
    return VibeMatchBadge(num: vibeMatchCount(selected, barTags), den: den)
}

public struct MatchesArgs {
    public var profile: VibeProfile
    public var coords: Coords?
    public var preferredNeighborhoods: [Neighborhood]
    /// Exclusive lower edge for a distance band; nil keeps nearby bars.
    public var minMilesExclusive: Double?
    public var maxMiles: Double?
    /// Broader travel searches rank the admitted pool together; exact miles
    /// still break ties.
    public var distanceBands: Bool
    public var bars: [Bar]
    public var excludeIds: [String]?
    public var maxResultsOverride: Int?
    public var now: Date?
    /// Live-surface clock for the LATE-NIGHT bias. Omitted on quiz/planning
    /// surfaces (they browse, not "right now").
    public var biasNow: Date?
    /// Learned taste from numeric scores. Omitted = no rating history, so
    /// c = 0 and the quiz prior alone orders the page — the cold-start case.
    public var taste: LearnedTaste

    public init(
        profile: VibeProfile,
        coords: Coords?,
        preferredNeighborhoods: [Neighborhood],
        minMilesExclusive: Double? = nil,
        maxMiles: Double?,
        distanceBands: Bool = true,
        bars: [Bar],
        excludeIds: [String]? = nil,
        maxResults: Int? = nil,
        now: Date? = nil,
        biasNow: Date? = nil,
        taste: LearnedTaste = emptyTaste
    ) {
        self.profile = profile
        self.coords = coords
        self.preferredNeighborhoods = preferredNeighborhoods
        self.minMilesExclusive = minMilesExclusive
        self.maxMiles = maxMiles
        self.distanceBands = distanceBands
        self.bars = bars
        self.excludeIds = excludeIds
        self.maxResultsOverride = maxResults
        self.now = now
        self.biasNow = biasNow
        self.taste = taste
    }
}

/// 10pm-3:59am in NEW YORK — when the night bias applies. `getHours()`
/// answers in the device's zone; this is an NYC-only matcher.
public func isLateNight(_ now: Date) -> Bool {
    let h = nycHour(now)
    if h.isNaN { return false } // broken clock: no bias rather than a wrong one
    return h >= Double(lateNightStartHour) || h < Double(lateNightEndHour)
}

/// Additive late-night nudge at tie-breaker scale: genuine nightlife
/// (club/dance) up, restaurant-bars down — unless the venue is BOTH.
public func lateNightAdjustment(_ bar: Bar) -> Double {
    let isClub = bar.tags.contains(.club) || bar.tags.contains(.dance)
    if isClub { return lateClubBoost }
    if bar.tags.contains(.restaurantBar) { return -lateRestaurantPenalty }
    return 0
}

/// Explicit-intent weighting — APPROVED product assumption (operator,
/// 2026-08-19). Do not re-tune silently; a change here is a product decision.
private let explicitVibeWeight: Double = 0.8
private let explicitTasteWeight: Double = 1 - explicitVibeWeight

/// A bar's WITHIN-BAND ordering value — the cascade's step 3:
///   c*learnedTaste + (1 - c)*quizPrior  (+ the late-night nudge)
/// Distance is deliberately ABSENT: it selects the band and breaks ties, it
/// is not a ranking term. Used when NO vibe tweak is active.
public func rankScore(_ bar: Bar, quizTags: [VibeTag], taste: LearnedTaste, late: Bool = false) -> Double {
    let c = taste.confidence
    return c * learnedTasteScore(bar, taste) + (1 - c) * jaccard(quizTags, bar.tags)
        + (late ? lateNightAdjustment(bar) : 0)
}

/// `rankScore`'s counterpart for an ACTIVE vibe tweak:
///   0.8*vibeMatch + 0.2*learnedTaste  (+ the same late-night nudge)
/// No confidence term — that is the whole point.
public func explicitVibeScore(_ bar: Bar, vibeTags: [VibeTag], taste: LearnedTaste, late: Bool = false) -> Double {
    explicitVibeWeight * jaccard(vibeTags, bar.tags) + explicitTasteWeight * learnedTasteScore(bar, taste)
        + (late ? lateNightAdjustment(bar) : 0)
}

public func matches(_ args: MatchesArgs) -> [Bar] {
    let nowForFreshness = args.now ?? Date()
    let exclude = Set(args.excludeIds ?? [])

    var pool = args.bars
        .filter { !exclude.contains($0.id) }
        // Never SUGGEST a dead bar: Places refresh found permanently-closed
        // catalog bars. Badge-only handling isn't enough — hard-filter them.
        .filter { $0.businessStatus != .closedPermanently }
        .filter { daysAgo($0.lastVerified, now: nowForFreshness) <= Double(lastVerifiedHardFilterDays) }

    if !args.preferredNeighborhoods.isEmpty {
        let allowed = Set(args.preferredNeighborhoods)
        pool = pool.filter { allowed.contains($0.neighborhood) }
    }

    // The explicit-intent path. Active only for an APPLIED tweak carrying at
    // least one tag. Resolved BEFORE the distance filter because an applied
    // pick changes what that filter admits.
    let selected = selectedVibes(args.profile)

    // ELIGIBILITY, not ordering (V8-R-NXT-009 / D-C-41). Runs BEFORE the
    // distance filter, before banding, before the cap. There is deliberately
    // no second pass that lets a rejected bar back in.
    if let selected {
        pool = pool.filter { isVibeEligible(selected, $0.tags) }
    }

    // Explicit vibes never widen a caller's geographic bounds.
    if let coords = args.coords, args.minMilesExclusive != nil || args.maxMiles != nil {
        pool = pool.filter { bar in
            let miles = haversineMiles(coords, bar.coords)
            return (args.minMilesExclusive == nil || miles > args.minMilesExclusive!)
                && (args.maxMiles == nil || miles <= args.maxMiles!)
        }
    }

    // JS `slice(0, cap)` with a negative cap is an empty list; Swift `prefix`
    // traps. Clamp once so the two agree (Codex review 2026-09-25).
    let cap = max(0, args.maxResultsOverride ?? maxResults)

    // ---- V8 P1 cascade -------------------------------------------------
    // Quiz tags are a COLD-START PRIOR, never an admission gate.
    let late = args.biasNow.map(isLateNight) ?? false

    let rankOf: (Bar) -> Double = selected != nil
        ? { bar in explicitVibeScore(bar, vibeTags: selected!, taste: args.taste, late: late) }
        : { bar in rankScore(bar, quizTags: args.profile.tags, taste: args.taste, late: late) }

    // Step 2 — fill from the CLOSEST band first, expanding only when the
    // closer band cannot fill the page. With no coords there is nothing to
    // band on, so the whole pool is one band (the pre-GPS behavior).
    let milesOf: (Bar) -> Double = args.coords != nil
        ? { bar in haversineMiles(args.coords!, bar.coords) }
        : { _ in 0 }

    var bands: [[Bar]]
    if let coords = args.coords, args.distanceBands {
        bands = [[], [], []]
        for bar in pool {
            let mi = haversineMiles(coords, bar.coords)
            let bandIndex = mi <= radiusWalk ? 0 : (mi <= radiusCab ? 1 : 2)
            bands[bandIndex].append(bar)
        }
    } else {
        bands = [pool]
    }

    // Steps 3 + 4 — within a band, learned taste orders; EXACT MILES are only
    // the final tie-breaker, never a ranking term of their own.
    var ranked: [(bar: Bar, score: Double, miles: Double)] = []
    for band in bands {
        if ranked.count >= cap { break }
        let scored = band.map { bar in (bar: bar, score: rankOf(bar), miles: milesOf(bar)) }
            .sorted { lhs, rhs in
                if lhs.score != rhs.score { return lhs.score > rhs.score }
                return lhs.miles < rhs.miles
            }
        ranked.append(contentsOf: scored)
    }

    return Array(ranked.prefix(cap)).map(\.bar)
}
