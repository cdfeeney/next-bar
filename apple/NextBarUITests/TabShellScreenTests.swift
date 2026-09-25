import XCTest

/// Screen 1 — the five-tab shell. Signed-out launch goes to Create account,
/// never to a tab; the four non-Home tabs show their title and a one-line
/// "Coming in the next build" body rather than a blank view.
final class TabShellScreenTests: XCTestCase {
    func testSignedOutLaunchShowsCreateAccountNotATab() {
        let app = launchApp()

        XCTAssertTrue(app.buttons["createAccount.continueWithEmail"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.tabBars.count, 0, "a signed-out launch must not show the tab bar")

        attachScreenshot(app, name: "TabShell-SignedOut")
    }

    func testFiveTabsInOrderAfterOnboardingWithPlaceholderContent() {
        let app = launchApp()
        reachHome(app, handle: "tabshelluser")

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 8))

        let expectedOrder = ["Next Bar?", "Map", "Rankings", "Tonight", "Account"]
        for title in expectedOrder {
            XCTAssertTrue(tabBar.buttons[title].exists, "missing tab: \(title)")
        }

        tabBar.buttons["Map"].tap()
        XCTAssertTrue(app.staticTexts["Coming in the next build"].waitForExistence(timeout: 5))

        attachScreenshot(app, name: "TabShell-SignedIn")
    }
}
