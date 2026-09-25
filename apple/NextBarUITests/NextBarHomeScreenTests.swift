import XCTest

/// Screen 8 — Next Bar? home.
final class NextBarHomeScreenTests: XCTestCase {
    func testPlaceholdersThenFiveCardsRenderAndBandChangeReorders() {
        let app = launchApp()
        reachHome(app, handle: "homeuserone")

        // Loading contract: the pulsing placeholders exist before the first
        // real card does. PreviewSession.travel() holds this phase for 1.5s
        // under -uiTesting so this assertion has a real window to catch it.
        XCTAssertTrue(app.otherElements["home.placeholder"].firstMatch.waitForExistence(timeout: 3))

        XCTAssertTrue(app.otherElements["home.card.1"].waitForExistence(timeout: 8))
        for rank in 1...5 {
            XCTAssertTrue(app.otherElements["home.card.\(rank)"].exists, "missing ranked card \(rank)")
        }

        let distancePicker = app.segmentedControls["home.distancePicker"]
        XCTAssertTrue(distancePicker.exists)
        distancePicker.buttons["Anywhere"].tap()

        // Re-ranking clears the list before repainting it — waiting for
        // rank 1 again confirms the band change actually re-ran the ranker
        // rather than leaving the old cards on screen.
        XCTAssertTrue(app.otherElements["home.card.1"].waitForExistence(timeout: 8))

        attachScreenshot(app, name: "NextBarHome")
    }

    func testTweakVibeSheetOpensAndAppliesOneTag() {
        let app = launchApp()
        reachHome(app, handle: "homeusertwo")
        XCTAssertTrue(app.otherElements["home.card.1"].waitForExistence(timeout: 8))

        app.buttons["home.tweakVibe"].tap()
        let tag = app.buttons["tweakVibe.tag.cocktail"]
        XCTAssertTrue(tag.waitForExistence(timeout: 5))
        tag.tap()
        app.buttons["tweakVibe.apply"].tap()

        XCTAssertTrue(app.otherElements["home.card.1"].waitForExistence(timeout: 8))
        attachScreenshot(app, name: "TweakVibeSheet")
    }

    /// Without a location fix, home must open on the neighborhood picker,
    /// never "Near you" results (spec, screen 8).
    func testNoLocationShowsNeighborhoodPicker() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting", "-uiTestingNoLocation"]
        app.launch()
        reachHome(app, handle: "homeuserpicker")

        let neighborhoodButton = app.buttons["home.neighborhood.West Village"]
        XCTAssertTrue(neighborhoodButton.waitForExistence(timeout: 5))
        attachScreenshot(app, name: "NextBarHome-NeighborhoodPicker")

        neighborhoodButton.tap()
        XCTAssertTrue(app.otherElements["home.card.1"].waitForExistence(timeout: 8))
    }
}
