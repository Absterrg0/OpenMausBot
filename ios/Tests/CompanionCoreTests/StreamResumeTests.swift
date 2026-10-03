import XCTest
@testable import CompanionCore

final class StreamResumeTests: XCTestCase {
    func testResumesThatCloseRightAfterHelloStartOverWithoutTheCursor() {
        // MOCA-179: the frame after the cursor is one the route cannot carry,
        // so every resume is hello and then a clean close.
        var resume = StreamResume()
        XCTAssertEqual(resume.cursor(resuming: "s:10"), "s:10")
        resume.ended(framesAfterHello: 0)
        XCTAssertEqual(resume.cursor(resuming: "s:10"), "s:10")
        resume.ended(framesAfterHello: 0)
        // Twice in a row: start fresh, and count again from there.
        XCTAssertNil(resume.cursor(resuming: "s:10"))
        XCTAssertEqual(resume.emptyResumes, 0)
        XCTAssertEqual(resume.cursor(resuming: "s:20"), "s:20")
    }

    func testAStreamThatDeliveredSomethingKeepsResuming() {
        var resume = StreamResume()
        resume.ended(framesAfterHello: 0)
        resume.ended(framesAfterHello: 3)
        resume.ended(framesAfterHello: 0)
        // Not two empty resumes in a row: the cursor is still worth using.
        XCTAssertEqual(resume.cursor(resuming: "s:30"), "s:30")
    }
}
