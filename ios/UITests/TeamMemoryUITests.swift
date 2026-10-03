import XCTest

/// A fresh simulator and bundled offline fleet, using URLProtocol instead
/// of any paired machine. The real views and Session handle both races.
final class TeamMemoryUITests: XCTestCase {
    @MainActor
    func testAcceptedMemoryCanBeEditedAndPendingWritesAreSerialized() {
        let app = launch(stale: false)
        edit(app)
        XCTAssertTrue(app.buttons["Save"].exists)
        XCTAssertFalse(app.buttons["Save"].isEnabled)
        XCTAssertFalse(app.buttons["Cancel"].isEnabled)
        XCTAssertFalse(app.textFields["team-memory-detail"].isEnabled)
        let detail = app.staticTexts["Reviewed HQ | writes: 1"]
        XCTAssertTrue(detail.waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["team-memory-detail"].waitForNonExistence(timeout: 5))
        record("Accepted memory edited once", app)
    }

    @MainActor
    func testOldComputerFailureDoesNotUnpairOrOverwriteTheNewComputer() {
        let app = launch(stale: true)
        edit(app)
        let current = app.staticTexts["Current host memory"]
        XCTAssertTrue(current.waitForExistence(timeout: 10))
        // The delayed old response is unauthorized. Wait past its delivery,
        // then ensure it did not move Session to pairing or show old memory.
        let settled = expectation(description: "old response settled")
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { settled.fulfill() }
        wait(for: [settled], timeout: 5)
        XCTAssertTrue(current.exists)
        XCTAssertFalse(app.staticTexts["Reviewed HQ | writes: 1"].exists)
        XCTAssertFalse(app.staticTexts["old computer revoked"].exists)
        record("Old computer response ignored", app)
    }

    @MainActor
    private func launch(stale: Bool) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = ["-store-preview", "-threads-preview", "-memory-preview", "-open-profile",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-companion.prefs.islandIntro", "never", "-companion.prefs.rosterDensity", "comfortable",
                               "-companion.onboarding.welcomeSeen", "YES", "-companion.onboarding.notificationsSeen", "YES"]
        if stale { app.launchArguments.append("-memory-stale-preview") }
        app.launch()
        let threads = app.buttons["threads-toggle.preview-pepper"]
        // Match the existing offline tests: a prewarmed/restored simulator
        // scene can retain its previous navigation on the first launch.
        if !threads.waitForExistence(timeout: 10) { app.terminate(); app.launch() }
        XCTAssertTrue(threads.waitForExistence(timeout: 10))
        threads.tap()
        app.buttons["thread.preview-gmail"].tap()
        let memory = app.buttons["Team memory"]
        if !memory.waitForExistence(timeout: 3) {
            app.swipeUp()
        }
        XCTAssertTrue(memory.waitForExistence(timeout: 5))
        memory.tap()
        XCTAssertTrue(app.staticTexts["Original HQ"].waitForExistence(timeout: 5))
        return app
    }

    @MainActor
    private func edit(_ app: XCUIApplication) {
        app.staticTexts["Original HQ"].swipeLeft()
        app.buttons["Edit"].tap()
        let detail = app.textFields["team-memory-detail"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        detail.tap()
        detail.press(forDuration: 1)
        if app.menuItems["Select All"].waitForExistence(timeout: 2) { app.menuItems["Select All"].tap() }
        detail.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 30) + "Reviewed HQ")
        app.buttons["Save"].tap()
    }

    @MainActor
    private func record(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
