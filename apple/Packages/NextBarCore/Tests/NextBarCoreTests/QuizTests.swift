import Testing
@testable import NextBarCore

/// Ports `src/lib/quiz.coverage.test.ts`.
struct QuizTests {
    /// TS: "every quiz-emittable tag matches at least one open bar" — requires
    /// the full bar catalog (`src/lib/bars.ts` + `src/lib/catalog.ts`'s Places
    /// overlay), which is data-ingestion scope, not ranking logic, and was not
    /// ported. Disabled rather than faked.
    @Test(
        "every quiz-emittable tag matches at least one open bar",
        .disabled("requires the full bars.ts/catalog.ts catalog, out of scope for the pure-logic port")
    )
    func everyQuizEmittableTagMatchesAnOpenBar() {}

    @Test(
        "the audit gap tags are now expressible: date, beer, pub, wine, live, post-work, romantic, garden, rooftop, splurge"
    )
    func auditGapTagsAreExpressible() {
        var emittable = Set<VibeTag>()
        for question in quiz {
            if case let .single(_, options) = question {
                for option in options { emittable.formUnion(option.tags) }
            }
        }
        let expected: [VibeTag] = [
            .date, .beer, .pub, .wine, .live, .postWork, .romantic, .garden, .rooftop, .splurge,
        ]
        for tag in expected {
            #expect(emittable.contains(tag), "\(tag) should be quiz-expressible")
        }
        // The dead tag stays un-emittable until bars actually carry it, and
        // 'tourist' is deliberately never offered (audit F4).
        #expect(!emittable.contains(.hiphop))
        #expect(!emittable.contains(.tourist))
    }
}
