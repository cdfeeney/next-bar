import SwiftUI
import NextBarCore

/// Screen 8's vibe sheet — the same tag vocabulary as the web, grouped by
/// `NextBarCore.axisOrder`/`vibeAxes`. Applying is an EXPLICIT pick (sets
/// `isExplicitVibe = true` on save), never the quiz's cold-start prior.
struct TweakVibeSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedTags: Set<VibeTag>
    let onApply: ([VibeTag]) -> Void

    init(selectedTags: Set<VibeTag>, onApply: @escaping ([VibeTag]) -> Void) {
        _selectedTags = State(initialValue: selectedTags)
        self.onApply = onApply
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(axisOrder, id: \.self) { axis in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(axis.rawValue)
                                .font(.nb(.semibold, 15))
                                .foregroundStyle(NBColor.textSecondary)

                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96))], spacing: 8) {
                                ForEach(vibeAxes[axis] ?? [], id: \.self) { tag in
                                    tagChip(tag)
                                }
                            }
                        }
                    }
                }
                .padding(24)
            }
            .background(NBColor.base.ignoresSafeArea())
            .navigationTitle("Tweak the vibe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        onApply(Array(selectedTags))
                        dismiss()
                    }
                    .accessibilityIdentifier("tweakVibe.apply")
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func tagChip(_ tag: VibeTag) -> some View {
        let isSelected = selectedTags.contains(tag)
        return Button(tag.rawValue.capitalized) {
            if isSelected { selectedTags.remove(tag) } else { selectedTags.insert(tag) }
        }
        .font(.nb(.regular, 13))
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(isSelected ? NBColor.orange : NBColor.card)
        .foregroundStyle(isSelected ? NBColor.base : NBColor.textPrimary)
        .clipShape(Capsule())
        .accessibilityIdentifier("tweakVibe.tag.\(tag.rawValue)")
    }
}
