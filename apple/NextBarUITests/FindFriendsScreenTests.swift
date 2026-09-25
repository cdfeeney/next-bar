import XCTest

/// Screen 7 — Find friends. "maya.nyc" is one of `PreviewSession`'s fixture
/// search rows (id "u1").
final class FindFriendsScreenTests: XCTestCase {
    func testSearchFollowToggleAndDoneReachesHome() {
        let app = launchApp()
        reachFindFriends(app, handle: "friendsuser")

        let search = app.textFields["findFriends.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("maya")

        let followButton = app.buttons["findFriends.follow.u1"]
        XCTAssertTrue(followButton.waitForExistence(timeout: 5))
        followButton.tap()
        XCTAssertEqual(followButton.label, "Following Maya")

        app.buttons["findFriends.done"].tap()
        XCTAssertTrue(app.tabBars.buttons["Next Bar?"].waitForExistence(timeout: 5))

        attachScreenshot(app, name: "FindFriends")
    }
}
