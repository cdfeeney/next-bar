import SwiftUI
import UIKit
import SafariServices

/// Wraps `SFSafariViewController` for the Terms/Privacy links (screen 2) —
/// the mission spec calls for it explicitly rather than `Link`, which would
/// leave the app.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
