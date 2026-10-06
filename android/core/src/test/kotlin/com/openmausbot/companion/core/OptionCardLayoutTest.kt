package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Which cards stack their answers full width and which keep them in a row.
 * Mirrors `ios/Tests/CompanionCoreTests/OptionCardLayoutTests.swift`.
 */
class OptionCardLayoutTest {
    @Test
    fun `a question stacks its options`() {
        val question = OptionCard(
            title = "Your bot has a question",
            subtitle = "Sending to Milind. Should it come from your Gmail?",
            options = listOf("Yes, from your Gmail — I'll give subject and body", "Use a different address"),
            requestType = "question",
        )
        assertTrue(question.stacksOptions)
    }

    @Test
    fun `proposals stack their options`() {
        val routine = OptionCard(
            title = "Create routine?",
            subtitle = "Every weekday at 9",
            options = listOf("Confirm", "Cancel"),
            requestId = "r",
            tool = "create_routine",
        )
        assertTrue(routine.stacksOptions)

        val memory = OptionCard(
            title = "Remember this for the team?",
            subtitle = "Person: Ana",
            options = listOf("Remember", "Skip"),
            tool = "propose_team_memory",
            teamMemoryRequest = TeamMemoryRequest("s", "e", "person"),
        )
        assertTrue(memory.stacksOptions)
    }

    @Test
    fun `approvals keep Allow and Deny side by side`() {
        val permission = OptionCard(
            title = "Approval needed",
            subtitle = "git push",
            options = listOf("Allow", "Deny"),
            tool = "Bash",
            requestType = "permission",
        )
        assertFalse(permission.stacksOptions)

        val legacy = OptionCard(title = "Approval needed", subtitle = "git push", options = listOf("Allow", "Deny"), tool = "Bash")
        assertFalse(legacy.stacksOptions, "older computers send no requestType")

        val outbound = OptionCard(
            title = "Send on your behalf?",
            subtitle = "Linear · Create comment",
            options = listOf("Allow", "Deny"),
            outboundRequest = OutboundRequest("LINEAR_CREATE_LINEAR_COMMENT", "Linear"),
        )
        assertFalse(outbound.stacksOptions)
    }
}
