import XCTest

/// Runs against the bundled QuestionPreview fleet. Mochi waits on a flat
/// question with nothing to pick, under an earlier one already answered; Pip
/// on a flat question with options; Juniper on a structured question with no
/// options. No paired computer and no API client, so nothing is sent.
final class QuestionCardUITests: XCTestCase {
    /// The computer's `ask_user` with no choices used to leave nothing to tap.
    /// The card opens to an answer field, and the composer answers it too.
    @MainActor
    func testAFlatQuestionWithNothingToPickOpensAnAnswerField() {
        let app = launchPreview(bot: "Mochi")

        XCTAssertTrue(app.staticTexts["Which email address should the reminder come from?"].firstMatch.waitForExistence(timeout: 5))
        let field = app.descendants(matching: .any)["card-answer-field"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 3), "the answer field is open")
        XCTAssertEqual(field.placeholderValue, "Type your answer")
        let send = app.buttons["card-answer-send"]
        XCTAssertTrue(send.exists)
        XCTAssertFalse(send.isEnabled, "nothing typed, nothing to send")

        // The earlier question shows the words it was answered with.
        XCTAssertTrue(app.staticTexts["Friday, after lunch"].exists)

        let input = app.descendants(matching: .any)["message-input"]
        XCTAssertEqual(input.placeholderValue, "Answer Mochi…")
        screenshot("Flat question with no options", in: app)

        field.tap()
        field.typeText("billing@example.com")
        XCTAssertTrue(send.isEnabled)
        screenshot("Flat question answer typed", in: app)
    }

    /// Options stay stacked; the field sits under them for anything else.
    @MainActor
    func testAFlatQuestionWithOptionsTakesWordsUnderThem() {
        let app = launchPreview(bot: "Pip")

        let last = app.buttons["Keep it short: Invoice due"]
        XCTAssertTrue(last.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["card-options-stacked"].exists)
        let field = app.descendants(matching: .any)["card-answer-field"].firstMatch
        XCTAssertTrue(field.exists)
        XCTAssertEqual(field.placeholderValue, "Type your own answer")
        XCTAssertGreaterThanOrEqual(field.frame.minY, last.frame.maxY, "under the options")

        XCTAssertEqual(app.descendants(matching: .any)["message-input"].placeholderValue, "Answer Pip…")
        screenshot("Flat question with options and an answer field", in: app)
    }

    /// A structured question with no options opens straight to its field
    /// instead of a lone "Other" row.
    @MainActor
    func testAStructuredQuestionWithNothingToPickOpensItsField() {
        let app = launchPreview(bot: "Juniper")

        XCTAssertTrue(app.staticTexts["Which folder should they go in?"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["question-answer-field"].exists)
        XCTAssertFalse(app.buttons["Other"].exists, "no lone Other row to tap first")
        XCTAssertTrue(app.buttons["Submit answer"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["message-input"].placeholderValue, "Answer Juniper…")
        screenshot("Structured question with no options", in: app)
    }

    @MainActor
    private func launchPreview(bot: String) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-store-preview", "-question-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.prefs.rosterDensity", "comfortable",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES"
        ]
        app.launch()
        if app.buttons["Connect computer"].exists {
            app.terminate()
            app.launch()
        }
        let input = app.descendants(matching: .any)["message-input"]
        // A restored chat may be another bot's: go back to the roster first.
        if input.waitForExistence(timeout: 3), input.placeholderValue != "Answer \(bot)…",
           app.buttons["Back"].exists {
            app.buttons["Back"].tap()
        }
        if !input.exists || input.placeholderValue != "Answer \(bot)…" {
            let row = app.buttons["chat-row.preview-\(bot.lowercased())"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 10), "\(bot) on the roster")
            // A waiting question raises the island over the top of the
            // roster for its first seconds; the bottom of the row stays clear.
            for _ in 0..<3 where !input.exists {
                row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.88)).tap()
                _ = input.waitForExistence(timeout: 3)
            }
        }
        XCTAssertTrue(input.exists, "\(bot)'s chat opened")
        return app
    }

    @MainActor
    private func screenshot(_ name: String, in app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
