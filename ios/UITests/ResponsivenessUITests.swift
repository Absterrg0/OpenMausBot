import XCTest

/// Synthetic fleet only: no account, network, microphone or message sends.
final class ResponsivenessUITests: XCTestCase {
    @MainActor
    func testShortChatTypingAndThreadSwitchingDuringBusyFleet() {
        continueAfterFailure = false
        let app = XCUIApplication()
        defer { app.terminate() }
        app.terminate()
        app.launchArguments = [
            "-store-preview", "-threads-preview", "-busy-fleet-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.prefs.rosterDensity", "comfortable",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES"
        ]
        app.launch()
        let threads = app.buttons["threads-toggle.preview-pepper"]
        XCTAssertTrue(threads.waitForExistence(timeout: 10))
        threads.tap()
        app.buttons["thread.preview-gmail"].tap()

        let progress = app.staticTexts["busy-fleet-progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 10))
        let before = cursorSequence(progress)
        let input = app.descendants(matching: .any)["message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        let typingStarted = Date()
        input.tap()
        input.typeText("Busy Gmail draft")
        XCTAssertEqual(input.value as? String, "Busy Gmail draft")
        record("Typed Gmail draft", started: typingStarted, progress: progress)

        let switchingStarted = Date()
        selectThread("preview-icloud", title: "Triage iCloud", in: app)
        XCTAssertNotEqual(input.value as? String, "Busy Gmail draft")
        input.tap()
        input.typeText("Busy iCloud draft")
        XCTAssertEqual(input.value as? String, "Busy iCloud draft")
        selectThread("preview-gmail", title: "Triage Gmail", in: app)
        XCTAssertEqual(input.value as? String, "Busy Gmail draft")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "I’m reviewing Gmail here"
        )).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "I am reviewing iCloud here"
        )).firstMatch.exists)
        record("Switched iCloud and returned with Gmail draft", started: switchingStarted, progress: progress)
        let after = cursorSequence(progress)
        XCTAssertGreaterThan(after, before, "The flood must advance during the actions")
        XCTAssertLessThan(after, 36_000, "The actions must finish while the flood is still active")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Short chat draft during synthetic busy fleet"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    private func cursorSequence(_ progress: XCUIElement) -> Int {
        let cursor = progress.value as? String ?? ""
        let sequence = Int(cursor.split(separator: ":").last ?? "")
        XCTAssertNotNil(sequence, "The fixture cursor must be readable: \(cursor)")
        return sequence ?? 0
    }

    @MainActor
    private func selectThread(_ id: String, title: String, in app: XCUIApplication) {
        app.buttons["thread-switcher"].tap()
        let thread = app.buttons["thread-\(id)"]
        XCTAssertTrue(thread.waitForExistence(timeout: 10))
        thread.tap()
        let titleArrived = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Switch thread: \(title)"),
            object: app.buttons["thread-switcher"]
        )
        XCTAssertEqual(XCTWaiter.wait(for: [titleArrived], timeout: 10), .completed)
    }

    @MainActor
    private func record(_ action: String, started: Date, progress: XCUIElement) {
        let note = XCTAttachment(string: "\(action): \(Date().timeIntervalSince(started))s; cursor=\(progress.value as? String ?? "missing")")
        note.name = action
        note.lifetime = .keepAlways
        add(note)
    }
}
