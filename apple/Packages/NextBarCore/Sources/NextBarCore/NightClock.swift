import Foundation

/// Ports the one function `matching.ts` imports from `src/lib/nightKey.ts`:
/// `nycHour`. The rest of that module (`nycNightKey`, `nycNightDay`, the
/// rollover-hour math) is not ranking logic and is out of this port's scope.
///
/// The New York wall-clock hour (0-23) at `now`, or `.nan` when `now` is
/// invalid — `getHours()` answers in the runner's/user's zone, which is the
/// exact mismatch this function exists to avoid.
///
/// Swift's `Date` has no "Invalid Date" literal the way JS does; the Swift
/// test port represents one the same way Foundation itself allows — a `Date`
/// built from `Double.nan` — so the fail-safe path stays exercised.
public func nycHour(_ now: Date) -> Double {
    guard now.timeIntervalSince1970.isFinite,
          let newYork = TimeZone(identifier: "America/New_York") else { return .nan }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = newYork
    return Double(calendar.component(.hour, from: now))
}
