import XCTest
@testable import CompanionCore

/// Which cards stack their answers full width and which keep them in a row.
final class OptionCardLayoutTests: XCTestCase {
    func testAQuestionStacksItsOptions() {
        var question = OptionCard(
            title: "Your bot has a question",
            subtitle: "Sending to Milind. Should it come from your Gmail?",
            options: ["Yes, from your Gmail — I'll give subject and body", "Use a different address"]
        )
        question.requestType = "question"
        XCTAssertTrue(question.stacksOptions)
    }

    func testProposalsStackTheirOptions() {
        var routine = OptionCard(title: "Create routine?", subtitle: "Every weekday at 9", options: ["Confirm", "Cancel"])
        routine.requestId = "r"
        routine.tool = "create_routine"
        XCTAssertTrue(routine.stacksOptions)

        var memory = OptionCard(title: "Remember this for the team?", subtitle: "Person: Ana", options: ["Remember", "Skip"])
        memory.tool = "propose_team_memory"
        memory.teamMemoryRequest = TeamMemoryRequest(section: "s", entryId: "e", kind: "person")
        XCTAssertTrue(memory.stacksOptions)
    }

    func testApprovalsKeepAllowAndDenySideBySide() {
        var permission = OptionCard(title: "Approval needed", subtitle: "git push", options: ["Allow", "Deny"])
        permission.requestType = "permission"
        permission.tool = "Bash"
        XCTAssertFalse(permission.stacksOptions)

        var legacy = OptionCard(title: "Approval needed", subtitle: "git push", options: ["Allow", "Deny"])
        legacy.tool = "Bash"
        XCTAssertFalse(legacy.stacksOptions, "older computers send no requestType")

        var outbound = OptionCard(title: "Send on your behalf?", subtitle: "Linear · Create comment", options: ["Allow", "Deny"])
        outbound.outboundRequest = OutboundRequest(tool: "LINEAR_CREATE_LINEAR_COMMENT", app: "Linear")
        XCTAssertFalse(outbound.stacksOptions)
    }
}
