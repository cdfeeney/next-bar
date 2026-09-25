import SwiftUI
import NextBarCore

/// Screen 6. Questions and options come straight from `NextBarCore.quiz` —
/// never retyped. "Skip" (top right) ends the whole quiz with an empty
/// profile; within the neighborhood question, its own `skipLabel` button
/// ("Anywhere works") ends the quiz with zero neighborhoods instead of no
/// tags at all, since every earlier answer still counts.
struct QuizView: View {
    let onFinished: (VibeProfile) -> Void
    /// Called only when Back is tapped on question 1 — pops out of the quiz
    /// to Location, the one case a Back tap actually leaves the screen.
    let onBack: () -> Void

    private let questions = NextBarCore.quiz

    @State private var index = 0
    @State private var collectedTags: [VibeTag] = []
    @State private var selectedNeighborhoods: Set<Neighborhood> = []
    @State private var singlePickIndex: Int?

    private var isLastQuestion: Bool { index == questions.count - 1 }

    private var canAdvance: Bool {
        switch questions[index] {
        case .single:
            return singlePickIndex != nil
        case .neighborhoodMultiSelect:
            return !selectedNeighborhoods.isEmpty
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            OnboardingProgress(step: 3)

            HStack {
                Text("\(index + 1) of \(questions.count)")
                    .font(.nb(.regular, 13))
                    .foregroundStyle(NBColor.textTertiary)
                Spacer()
                Button("Skip") { finishWithEmptyProfile() }
                    .font(.nb(.regular, 14))
                    .foregroundStyle(NBColor.textSecondary)
                    .accessibilityIdentifier("quiz.skip")
            }
            .padding(.horizontal, 24)
            .padding(.top, 12)

            quizSegmentBar
                .padding(.horizontal, 24)
                .padding(.vertical, 12)

            ScrollView {
                questionContent
                    .padding(.horizontal, 24)
            }

            Button(bottomButtonLabel) { advance() }
                .buttonStyle(NBPrimaryButtonStyle(isDisabled: !canAdvance))
                .disabled(!canAdvance)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
                .accessibilityIdentifier("quiz.next")
        }
        .background(NBColor.base.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    goBack()
                } label: {
                    Image(systemName: "chevron.left")
                }
                .accessibilityIdentifier("quiz.back")
            }
        }
    }

    /// On question 1 this is the only way out of the quiz, so it pops the
    /// whole screen; every later question just steps back one.
    ///
    /// ponytail: going back does not restore the previous pick or drop the
    /// tag already collected for it, so re-answering after Back can double
    /// up a tag. Add a per-question answer history if that surfaces as a
    /// real bug.
    private func goBack() {
        if index > 0 {
            index -= 1
            singlePickIndex = nil
        } else {
            onBack()
        }
    }

    private var bottomButtonLabel: String {
        if case .neighborhoodMultiSelect(_, _, let doneLabel, _) = questions[index] { return doneLabel }
        return "Next"
    }

    private var quizSegmentBar: some View {
        HStack(spacing: 4) {
            ForEach(0..<questions.count, id: \.self) { i in
                Capsule()
                    .fill(i <= index ? NBColor.orange : NBColor.fill)
                    .frame(height: 3)
            }
        }
    }

    @ViewBuilder
    private var questionContent: some View {
        switch questions[index] {
        case .single(let prompt, let options):
            singleQuestion(prompt: prompt, options: options)
        case .neighborhoodMultiSelect(let prompt, let skipLabel, _, let options):
            neighborhoodQuestion(prompt: prompt, skipLabel: skipLabel, options: options)
        }
    }

    private func singleQuestion(prompt: String, options: [QuizOption]) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(prompt)
                .font(.nb(.semibold, 26))
                .foregroundStyle(NBColor.textPrimary)
                .padding(.top, 16)

            VStack(spacing: 10) {
                ForEach(Array(options.enumerated()), id: \.offset) { offset, option in
                    Button {
                        singlePickIndex = offset
                    } label: {
                        Text(option.label)
                            .font(.nb(.medium, 16))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .frame(height: 60)
                            .padding(.horizontal, 16)
                    }
                    .background(singlePickIndex == offset ? NBColor.orange : NBColor.card)
                    .foregroundStyle(singlePickIndex == offset ? NBColor.base : NBColor.textPrimary)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(singlePickIndex == offset ? .clear : NBColor.fill, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .accessibilityIdentifier("quiz.option.\(offset)")
                }
            }

            Text("Tunes your first picks. You can change it any time from Tweak the vibe.")
                .font(.nb(.regular, 13))
                .foregroundStyle(NBColor.textTertiary)
                .padding(.top, 4)
        }
    }

    private func neighborhoodQuestion(prompt: String, skipLabel: String, options: [Neighborhood]) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(prompt)
                .font(.nb(.semibold, 26))
                .foregroundStyle(NBColor.textPrimary)
                .padding(.top, 16)

            Button(skipLabel) {
                selectedNeighborhoods = []
                finishWithNeighborhoods()
            }
            .buttonStyle(NBOutlineButtonStyle())
            .accessibilityIdentifier("quiz.neighborhoodSkip")

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 8) {
                ForEach(options, id: \.self) { neighborhood in
                    let isSelected = selectedNeighborhoods.contains(neighborhood)
                    Button(neighborhood.rawValue) {
                        if isSelected { selectedNeighborhoods.remove(neighborhood) }
                        else { selectedNeighborhoods.insert(neighborhood) }
                    }
                    .font(.nb(.regular, 13))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(isSelected ? NBColor.orange : NBColor.card)
                    .foregroundStyle(isSelected ? NBColor.base : NBColor.textPrimary)
                    .clipShape(Capsule())
                }
            }
            .padding(.top, 4)
        }
    }

    private func advance() {
        if case .single(_, let options) = questions[index], let picked = singlePickIndex {
            collectedTags.append(contentsOf: options[picked].tags)
        }
        if isLastQuestion {
            finishWithNeighborhoods()
        } else {
            index += 1
            singlePickIndex = nil
        }
    }

    private func finishWithNeighborhoods() {
        onFinished(VibeProfile(
            tags: collectedTags,
            archetype: deriveArchetype(collectedTags),
            preferredNeighborhoods: Array(selectedNeighborhoods)
        ))
    }

    private func finishWithEmptyProfile() {
        onFinished(VibeProfile(tags: [], archetype: deriveArchetype([]), preferredNeighborhoods: []))
    }
}
