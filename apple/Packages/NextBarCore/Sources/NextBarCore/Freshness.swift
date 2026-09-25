import Foundation

/// Ports the one function `matching.ts` imports from `src/lib/freshness.ts`:
/// `daysAgo`. `isFresh`/`formatVerified` are display-layer helpers, not
/// ranking logic, and are out of this port's scope.
private let msPerDay: Double = 1000 * 60 * 60 * 24

/// How many whole days ago `isoDate` was, relative to `now`. An unparseable
/// date returns `+infinity` (ports `Number.POSITIVE_INFINITY`), so it always
/// fails a "within N days" freshness check rather than looking fresh.
public func daysAgo(_ isoDate: String, now: Date = Date()) -> Double {
    guard let then = parseISODate(isoDate) else { return .infinity }
    let diffMs = now.timeIntervalSince(then) * 1000
    return (diffMs / msPerDay).rounded(.down)
}

/// ISO-8601 parsing as wide as JS `new Date(iso)` for the shapes Supabase can
/// emit: an internet date-time with any offset (`Z`, `+00:00`), with or without
/// fractional seconds of any length, or a bare `yyyy-MM-dd` (UTC midnight,
/// matching JS). Codex review 2026-09-25: the earlier three-format parser sent
/// valid offsets to `+infinity`, which the freshness gate then hard-filtered.
func parseISODate(_ s: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFraction.date(from: normalisedFraction(s)) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    if let date = plain.date(from: s) { return date }
    let dateOnly = DateFormatter()
    dateOnly.locale = Locale(identifier: "en_US_POSIX")
    dateOnly.timeZone = TimeZone(identifier: "UTC")
    dateOnly.dateFormat = "yyyy-MM-dd"
    return dateOnly.date(from: s)
}

/// `ISO8601DateFormatter` accepts exactly three fractional digits; Postgres
/// emits up to six. Trim or pad the fraction so both parse.
private func normalisedFraction(_ s: String) -> String {
    guard let dot = s.firstIndex(of: "."),
          let end = s[dot...].firstIndex(where: { $0 == "Z" || $0 == "+" || $0 == "-" }) else { return s }
    let digits = String(s[s.index(after: dot)..<end])
    guard !digits.isEmpty, digits.allSatisfy(\.isNumber) else { return s }
    let three = (digits + "000").prefix(3)
    return String(s[..<dot]) + "." + three + String(s[end...])
}
