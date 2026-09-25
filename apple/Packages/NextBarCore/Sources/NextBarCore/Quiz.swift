import Foundation

/// Ports `src/lib/quiz.ts`.
public struct QuizOption: Sendable {
    public let label: String
    public let tags: [VibeTag]
}

/// Ports the TS discriminated union `QuizQuestion` (`SinglePickQuestion` |
/// `NeighborhoodMultiSelectQuestion`).
public enum QuizQuestion: Sendable {
    case single(prompt: String, options: [QuizOption])
    case neighborhoodMultiSelect(
        prompt: String, skipLabel: String, doneLabel: String, options: [Neighborhood]
    )
}

/// The 8 quiz questions, verbatim from `quiz.ts` (7 single-pick + 1
/// neighborhood multi-select).
public let quiz: [QuizQuestion] = [
    .single(
        prompt: "Friday, 11pm. What sounds good?",
        options: [
            QuizOption(label: "A dive with a jukebox", tags: [.dive, .rough, .oldNyc]),
            QuizOption(label: "A hidden cocktail spot", tags: [.speakeasy, .cocktail, .polished]),
            QuizOption(label: "Cold pints at a proper pub", tags: [.pub, .beer]),
            QuizOption(label: "A good glass of wine", tags: [.wine, .chill]),
        ]
    ),
    .single(
        prompt: "What energy are you bringing?",
        options: [
            QuizOption(label: "Loud — bring the noise", tags: [.loud, .buzzy]),
            QuizOption(label: "Mellow — we wanna talk", tags: [.chill]),
        ]
    ),
    .single(
        prompt: "Where do you wanna be?",
        options: [
            QuizOption(label: "A backyard or garden", tags: [.garden, .chill]),
            QuizOption(label: "A rooftop with views", tags: [.rooftop, .instagrammable]),
            QuizOption(label: "Tucked away inside", tags: [.lounge, .speakeasy]),
            QuizOption(label: "On a dance floor", tags: [.club, .dance]),
        ]
    ),
    .single(
        prompt: "Soundtrack of the night?",
        options: [
            QuizOption(label: "Indie / rock", tags: [.indie, .rough]),
            QuizOption(label: "DJs & dancing", tags: [.dance, .house, .loud]),
            QuizOption(label: "Live music", tags: [.live, .jazz]),
            QuizOption(label: "Jazz / lounge", tags: [.jazz, .lounge]),
        ]
    ),
    .single(
        prompt: "Who do you wanna be around?",
        options: [
            QuizOption(label: "Locals & regulars", tags: [.locals, .oldNyc, .dive]),
            QuizOption(label: "Trendy and lively", tags: [.trendy, .instagrammable]),
            QuizOption(label: "Industry / creative", tags: [.industry, .cocktail]),
        ]
    ),
    .single(
        prompt: "Who are you out with?",
        options: [
            QuizOption(label: "On a date", tags: [.date, .romantic, .cocktail]),
            QuizOption(label: "Post-work crew", tags: [.postWork, .beer]),
            QuizOption(label: "The whole group, going late", tags: [.buzzy, .loud, .dance]),
            QuizOption(label: "Solo or one good friend", tags: [.chill, .locals]),
        ]
    ),
    .single(
        prompt: "Spending vibe tonight?",
        options: [
            QuizOption(label: "Cheap and cheerful", tags: [.cheap, .dive]),
            QuizOption(label: "Solid middle", tags: [.mid]),
            QuizOption(label: "Treating myself", tags: [.pricey, .cocktail]),
            QuizOption(label: "Big night, no limits", tags: [.splurge, .polished]),
        ]
    ),
    .neighborhoodMultiSelect(
        prompt: "Any neighborhoods you love?",
        skipLabel: "Anywhere works",
        doneLabel: "Done",
        options: [
            .fiDi, .les, .soHo, .eastVillage, .westVillage, .chelsea, .midtown,
            .hellsKitchen, .uws, .ues, .harlem, .tribeca, .batteryParkCity,
            .hamiltonHeights, .flatiron, .greenwichVillage, .noHo, .hudsonSquare,
            .gramercy, .kipsBay, .eastHarlem, .morningsideHeights,
            .washingtonHeights, .inwood, .chinatown, .williamsburg, .greenpoint,
            .bushwick, .parkSlope, .fortGreene, .gowanus, .astoria, .lic, .ridgewood,
        ]
    ),
]

/// Ports `deriveArchetype`. Order of checks matters — first match wins.
public func deriveArchetype(_ tags: [VibeTag]) -> String {
    func has(_ tag: VibeTag) -> Bool { tags.contains(tag) }

    if has(.dive) && has(.locals) { return "Dive devotee" }
    if has(.cocktail) && has(.polished) { return "Cocktail connoisseur" }
    if has(.speakeasy) && has(.romantic) { return "Hidden-door romantic" }
    if has(.dance) && has(.house) { return "Late-night dancefloor" }
    if has(.jazz) && has(.lounge) { return "Jazz lounge sophisticate" }
    if has(.rough) && has(.cheap) { return "No-frills regular" }
    if has(.trendy) && has(.instagrammable) { return "New-wave trendsetter" }
    if has(.industry) && has(.cocktail) { return "Industry-crowd insider" }
    if has(.rooftop) { return "Skyline-view chaser" }
    if has(.garden) && has(.chill) { return "Backyard session regular" }
    if has(.wine) && has(.romantic) { return "Wine-bar romantic" }
    return "NYC vibe explorer"
}
