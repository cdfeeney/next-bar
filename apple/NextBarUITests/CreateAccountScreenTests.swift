import XCTest

/// Screen 2 — Create account.
final class CreateAccountScreenTests: XCTestCase {
    func testControlsPresentAndEmailValidation() {
        let app = launchApp()

        // SignInWithAppleButton is UIKit-hosted inside SwiftUI, so it does not
        // surface as an XCUIElementType.button — look it up as a descendant
        // of any type instead.
        XCTAssertTrue(app.descendants(matching: .any)["createAccount.continueWithApple"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["createAccount.continueWithGoogle"].exists)
        let emailField = app.textFields["createAccount.emailField"]
        XCTAssertTrue(emailField.exists)
        let continueButton = app.buttons["createAccount.continueWithEmail"]
        XCTAssertTrue(continueButton.exists)

        // Empty email disables Continue.
        XCTAssertFalse(continueButton.isEnabled)

        // A malformed email shows one inline error line.
        emailField.tap()
        emailField.typeText("not-an-email")
        continueButton.tap()

        let error = app.staticTexts["createAccount.emailError"]
        XCTAssertTrue(error.waitForExistence(timeout: 3))

        attachScreenshot(app, name: "CreateAccount")
    }
}
