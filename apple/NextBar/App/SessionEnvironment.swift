import SwiftUI

private struct SessionKey: EnvironmentKey {
    static let defaultValue: any Session = PreviewSession()
}

extension EnvironmentValues {
    var session: any Session {
        get { self[SessionKey.self] }
        set { self[SessionKey.self] = newValue }
    }
}
