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

/// A small flexible ISO-8601 parser covering what `bars.ts` fixtures and test
/// fixtures actually use: full timestamps and bare `yyyy-MM-dd` dates (the
/// latter parsed as UTC midnight, matching JS `new Date('yyyy-MM-dd')`).
func parseISODate(_ s: String) -> Date? {
    let formats = [
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd",
    ]
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    for format in formats {
        formatter.dateFormat = format
        if let date = formatter.date(from: s) { return date }
    }
    return nil
}
