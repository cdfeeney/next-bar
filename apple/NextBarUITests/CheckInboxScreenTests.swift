import XCTest

/// Screen 3 — Check inbox.
final class CheckInboxScreenTests: XCTestCase {
    func testResendDisabledWithCountdownAndChangeEmailReturnsPrefilled() {
        let app = launchApp()

        let email = "test@example.com"
        let emailField = app.textFields["createAccount.emailField"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        emailField.tap()
        emailField.typeText(email)
        app.buttons["createAccount.continueWithEmail"].tap()

        let resend = app.buttons["checkInbox.resend"]
        XCTAssertTrue(resend.waitForExistence(timeout: 5))
        XCTAssertFalse(resend.isEnabled)
        XCTAssertTrue(resend.label.contains("s)"), "expected a countdown in the resend label, got \(resend.label)")

        attachScreenshot(app, name: "CheckInbox")

        app.buttons["checkInbox.changeEmail"].tap()

        let backEmailField = app.textFields["createAccount.emailField"]
        XCTAssertTrue(backEmailField.waitForExistence(timeout: 5))
        XCTAssertEqual(backEmailField.value as? String, email)
    }
}
