import XCTest

final class BrowserControlUITests: XCTestCase {
    @MainActor
    func testWatchingTakeTouchHandbackAndLeavingReleaseTheExactViewer() {
        let app = XCUIApplication()
        app.launchArguments = ["-store-preview", "-threads-preview", "-browser-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES", "-companion.onboarding.notificationsSeen", "YES"]
        app.launch()
        app.buttons["Open browser"].tap()
        let take = app.buttons["Take control"]
        XCTAssertTrue(take.waitForExistence(timeout: 10))
        let address = app.textFields["Address"]
        XCTAssertFalse(address.isEnabled)
        XCTAssertTrue(app.images["Pepper's browser"].waitForExistence(timeout: 5))
        take.tap()
        XCTAssertTrue(app.buttons["Hand back"].waitForExistence(timeout: 5))
        app.images["Pepper's browser"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        expectation(for: NSPredicate(format: "value CONTAINS %@", "/tap?x="), evaluatedWith: address)
        waitForExpectations(timeout: 5)
        let tap = URLComponents(string: address.value as? String ?? "")?.queryItems ?? []
        XCTAssertEqual(Double(tap.first { $0.name == "x" }?.value ?? "") ?? -1, 640, accuracy: 2)
        XCTAssertEqual(Double(tap.first { $0.name == "y" }?.value ?? "") ?? -1, 360, accuracy: 2)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Native browser receives a mapped tap"
        shot.lifetime = .keepAlways
        add(shot)
        app.buttons["Keyboard"].tap()
        app.typeText("Ada")
        expectation(for: NSPredicate(format: "value CONTAINS %@", "typed?value=Ada"), evaluatedWith: address)
        waitForExpectations(timeout: 5)
        app.buttons["Hand back"].tap()
        XCTAssertTrue(take.waitForExistence(timeout: 5))
        XCTAssertFalse(address.isEnabled)
        take.tap()
        XCTAssertTrue(app.buttons["Hand back"].waitForExistence(timeout: 5))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(take.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "value CONTAINS %@", "releases=2"), evaluatedWith: address)
        waitForExpectations(timeout: 5)
        XCTAssertFalse(address.isEnabled)
        take.tap()
        XCTAssertTrue(app.buttons["Hand back"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["Browser fixture"].tap()
        app.buttons["Open browser"].tap()
        XCTAssertTrue(take.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "value CONTAINS %@", "releases=3"), evaluatedWith: address)
        waitForExpectations(timeout: 5)
        XCTAssertFalse(address.isEnabled)
    }
}
