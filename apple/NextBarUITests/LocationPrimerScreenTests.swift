import XCTest

/// Screen 5 — Location primer. Denying the system permission prompt must
/// still reach the quiz; the primer only ever asks once.
final class LocationPrimerScreenTests: XCTestCase {
    func testLocationDeniedStillReachesQuiz() {
        let app = launchApp()
        goToUsername(app)
        claimUsernameAndContinue(app, handle: "locationtestuser")

        let shareButton = app.buttons["locationPrimer.share"]
        XCTAssertTrue(shareButton.waitForExistence(timeout: 5))
        attachScreenshot(app, name: "LocationPrimer")

        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            for label in ["Don’t Allow", "Don't Allow", "Don't Allow While Using App"] {
                let button = alert.buttons[label]
                if button.exists {
                    button.tap()
                    return true
                }
            }
            return false
        }

        shareButton.tap()
        // Interruption monitors only fire on the next interaction with the
        // app, per Apple's documented XCUITest behavior.
        app.tap()

        let quizSkip = app.buttons["quiz.skip"]
        XCTAssertTrue(quizSkip.waitForExistence(timeout: 8))
    }
}
