import XCTest
@testable import CompanionCore

final class ReasoningWindowTests: XCTestCase {
    func testWindowPreservesAbsoluteNumbersAndTotal() {
        let window = ReasoningWindow("one\n \ntwo\nthree", characterLimit: 8)
        XCTAssertEqual(window.total, 3)
        XCTAssertEqual(window.steps.map(\.number), [2, 3])
        XCTAssertEqual(window.steps.map(\.text), ["two", "three"])
    }

    func testOversizedNewestStepCannotExceedCap() {
        let window = ReasoningWindow("old\n" + String(repeating: "👩🏽‍💻", count: 100), characterLimit: 8)
        XCTAssertEqual(window.total, 2)
        XCTAssertEqual(window.steps.first?.number, 2)
        XCTAssertEqual(window.steps.first?.text, "…" + String(repeating: "👩🏽‍💻", count: 7))
    }

    func testEmptyAndZeroWindows() {
        XCTAssertEqual(ReasoningWindow(" \n\t").total, 0)
        XCTAssertTrue(ReasoningWindow("one", characterLimit: 0).steps.isEmpty)
        XCTAssertEqual(ReasoningWindow("one", characterLimit: 1).steps.first?.text, "…")
    }

    func testCollapsedWindowKeepsWhitespaceAndUnicodeStepCountWithoutExcerpts() {
        let reasoning = "\n\t \n first \n\u{2003}\n👩🏽‍💻\nlast\n"
        let collapsed = ReasoningWindow(reasoning, characterLimit: 0)
        XCTAssertEqual(collapsed.total, 3)
        XCTAssertTrue(collapsed.steps.isEmpty)
        let expanded = ReasoningWindow(reasoning)
        XCTAssertEqual(expanded.steps.map(\.text), [" first ", "👩🏽‍💻", "last"])
        XCTAssertEqual(expanded.steps.map(\.number), [1, 2, 3])
    }

    func testCRLFStillSplitsStepsAndBoundsTheNewestExcerpt() {
        let text = "first\r\nsecond\r\nthird"
        XCTAssertEqual(ReasoningWindow(text, characterLimit: 0).total, 3)
        let window = ReasoningWindow(text, characterLimit: 5)
        XCTAssertEqual(window.total, 3)
        XCTAssertEqual(window.steps.map(\.number), [3])
        XCTAssertEqual(window.steps.map(\.text), ["third"])
        XCTAssertEqual(ReasoningWindow("lone\rreturn").total, 1)
    }
}
