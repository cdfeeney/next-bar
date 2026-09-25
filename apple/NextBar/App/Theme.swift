import SwiftUI

extension Color {
    /// `0xRRGGBB`, no alpha — every token in the warm-grey ladder is opaque.
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}

/// The warm-grey ladder + orange accent approved 2026-09-24. Dark is the
/// product; there is no separate light palette in push 1.
enum NBColor {
    static let base = Color(hex: 0x0b0a09)
    static let card = Color(hex: 0x161412)
    static let raised = Color(hex: 0x211e1b)
    static let fill = Color(hex: 0x2c2824)
    static let selected = Color(hex: 0x3a3531)

    static let textPrimary = Color(hex: 0xf5f2ee)
    static let textSecondary = Color(hex: 0xa8a29b)
    static let textTertiary = Color(hex: 0x6f6962)

    static let orange = Color(hex: 0xff5b3a)
    static let orangeText = Color(hex: 0xff8a6e)
    static let orangeSoft = Color(hex: 0x3a1c14)
    static let orangeDeep = Color(hex: 0x9e2f1a)
    static let orangePressed = Color(hex: 0xe0482a)
}

/// The brand pair is Poppins 400/500/600, plus 700 for the Next Bar? home
/// wordmark (spec, screen 8). Bundled at `NextBar/Resources/Fonts/` and
/// registered via `project.yml`'s `UIAppFonts` — see apple/README.md.
enum NBWeight {
    case regular, medium, semibold, bold

    var postscriptName: String {
        switch self {
        case .regular: return "Poppins-Regular"
        case .medium: return "Poppins-Medium"
        case .semibold: return "Poppins-SemiBold"
        case .bold: return "Poppins-Bold"
        }
    }
}

extension Font {
    static func nb(_ weight: NBWeight, _ size: CGFloat) -> Font {
        .custom(weight.postscriptName, size: size)
    }
}

/// One 50pt pill button, orange fill, used once per screen per the spec.
struct NBPrimaryButtonStyle: ButtonStyle {
    var isDisabled: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.nb(.medium, 16))
            .foregroundStyle(NBColor.base)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(isDisabled ? NBColor.orange.opacity(0.4) : (configuration.isPressed ? NBColor.orangePressed : NBColor.orange))
            .clipShape(Capsule())
    }
}

struct NBOutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.nb(.medium, 16))
            .foregroundStyle(NBColor.textPrimary)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(configuration.isPressed ? NBColor.raised : NBColor.card)
            .overlay(Capsule().strokeBorder(NBColor.fill, lineWidth: 1))
            .clipShape(Capsule())
    }
}
