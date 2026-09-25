import XCTest

/// Screen 6 — Vibe quiz.
final class QuizScreenTests: XCTestCase {
    func testAnsweringAllEightQuestionsReachesFindFriends() {
        let app = launchApp()
        goToUsername(app)
        claimUsernameAndContinue(app, handle: "quizuserall")
        skipLocationPrimer(app)

        XCTAssertTrue(app.buttons["quiz.next"].waitForExistence(timeout: 5))
        // Seven single-pick questions: take the first option and advance.
        for _ in 0..<7 {
            app.buttons["quiz.option.0"].tap()
            app.buttons["quiz.next"].tap()
        }
        // Question 8 is the neighborhood multi-select; its own "Anywhere
        // works" button finishes the quiz with zero neighborhoods.
        app.buttons["quiz.neighborhoodSkip"].tap()

        XCTAssertTrue(app.buttons["findFriends.done"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Quiz-AllAnswered")
    }

    func testSkipOnFirstQuestionReachesFindFriends() {
        let app = launchApp()
        goToUsername(app)
        claimUsernameAndContinue(app, handle: "quizuserskip")
        skipLocationPrimer(app)

        let skip = app.buttons["quiz.skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 5))
        skip.tap()

        XCTAssertTrue(app.buttons["findFriends.done"].waitForExistence(timeout: 5))
        attachScreenshot(app, name: "Quiz-Skip")
    }
}
