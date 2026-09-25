import XCTest

/// Screen 4 — Username. "taken" is one of `PreviewSession`'s fixture
/// handles.
final class UsernameScreenTests: XCTestCase {
    func testTakenHandleDisablesContinueThenFreeHandleEnablesIt() {
        let app = launchApp()
        goToUsername(app)

        let field = app.textFields["username.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("taken")

        let takenLabel = app.staticTexts["username.takenLabel"]
        XCTAssertTrue(takenLabel.waitForExistence(timeout: 3))
        let continueButton = app.buttons["username.continue"]
        XCTAssertFalse(continueButton.isEnabled)

        field.typeText(String(repeating: "\u{8}", count: "taken".count))
        field.typeText("freshhandle1")

        waitUntilEnabled(continueButton)

        attachScreenshot(app, name: "Username")
    }
}
