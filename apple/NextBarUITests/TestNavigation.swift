import XCTest

/// Shared driving helpers so each screen's test file only needs to state
/// what it is actually checking, not re-derive how to get there.
extension XCTestCase {
    func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting"]
        app.launch()
        return app
    }

    /// Screen 2 → screen 4, via the stub's instant-auth "Continue with
    /// Google" path (never the real Sign in with Apple sheet, which cannot
    /// run unattended in CI).
    @discardableResult
    func goToUsername(_ app: XCUIApplication) -> XCUIApplication {
        let google = app.buttons["createAccount.continueWithGoogle"]
        XCTAssertTrue(google.waitForExistence(timeout: 5), "Create account did not appear")
        google.tap()
        return app
    }

    /// Claims `handle` on the Username screen (screen 4) and lands on
    /// Location primer (screen 5).
    @discardableResult
    func claimUsernameAndContinue(_ app: XCUIApplication, handle: String) -> XCUIApplication {
        let field = app.textFields["username.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "Username field did not appear")
        field.tap()
        field.typeText(handle)

        let continueButton = app.buttons["username.continue"]
        waitUntilEnabled(continueButton)
        continueButton.tap()
        return app
    }

    /// Location primer (screen 5) → Quiz (screen 6), via "Not now" — avoids
    /// the flaky system location-permission alert for tests that only need
    /// to get past this screen.
    @discardableResult
    func skipLocationPrimer(_ app: XCUIApplication) -> XCUIApplication {
        let notNow = app.buttons["locationPrimer.notNow"]
        XCTAssertTrue(notNow.waitForExistence(timeout: 5), "Location primer did not appear")
        notNow.tap()
        return app
    }

    /// Screen 2 all the way to Find friends (screen 7), skipping the quiz —
    /// the fastest deterministic path for tests whose subject is a later
    /// screen.
    @discardableResult
    func reachFindFriends(_ app: XCUIApplication, handle: String) -> XCUIApplication {
        goToUsername(app)
        claimUsernameAndContinue(app, handle: handle)
        skipLocationPrimer(app)
        let skip = app.buttons["quiz.skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 5), "Quiz did not appear")
        skip.tap()
        return app
    }

    /// All the way to Next Bar? home (screen 8) — signs in for real via
    /// "Done" on Find friends, which is what flips `AppState.isSignedIn`.
    @discardableResult
    func reachHome(_ app: XCUIApplication, handle: String) -> XCUIApplication {
        reachFindFriends(app, handle: handle)
        let done = app.buttons["findFriends.done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5), "Find friends did not appear")
        done.tap()
        return app
    }

    func waitUntilEnabled(_ element: XCUIElement, timeout: TimeInterval = 5) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout))
        let predicate = NSPredicate(format: "isEnabled == true")
        expectation(for: predicate, evaluatedWith: element)
        waitForExpectations(timeout: timeout)
    }

    func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
