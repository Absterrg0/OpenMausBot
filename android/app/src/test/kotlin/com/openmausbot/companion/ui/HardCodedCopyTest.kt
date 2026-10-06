package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.openmausbot.companion.R
import com.openmausbot.companion.core.Message
import java.io.File
import kotlin.test.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * MOCA-291: copy written straight into Kotlin stays English on a Chinese
 * phone. Every screen in `ui/` must take its words from `strings.xml`, either
 * with `stringResource` or through `localizedMobileCopy`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HardCodedCopyTest {
    @get:Rule val compose = createComposeRule()

    private val root = File("src/main/kotlin/com/openmausbot/companion/ui").takeIf(File::isDirectory)
        ?: File("app/src/main/kotlin/com/openmausbot/companion/ui")

    /**
     * Live calls and browser / computer control, localized by PR #2296 with
     * CallAndControlCopyTest as their guard. Drop these once it lands.
     */
    private val coveredElsewhere = setOf(
        "LiveCallBar.kt",
        "LiveCallBanner.kt",
        "LiveCallSettingsSheet.kt",
        "BrowserControlScreen.kt",
        "ComputerScreen.kt",
        "CompactRoster.kt",
    )

    /** English that is meant to stay in Kotlin. Keep this short and say why. */
    private val allowed = setOf(
        // ChatScreen shows the attachment sheet by ChatActionId (localizedChatActionSubtitle);
        // these subtitles only feed ChatPolicyTest.
        "Start a fresh thread with \${bot.name}",
        "Live view of what \${bot.name} is doing",
        "Start a fresh conversation in \${chat.name}",
    )

    @Test
    fun screensDoNotHandEnglishStraightToTheUi() {
        val offenders = screens().flatMap { (name, source) ->
            raw.findAll(source).mapNotNull { match ->
                match.literal().takeIf(::isCopy)?.let { "$name:${source.lineOf(match)}: \"$it\"" }
            }
        }
        assertEquals(emptyList(), offenders, "Use stringResource(R.string.…) for these")
    }

    @Test
    fun copyGivenToLocalizingHelpersIsInTheCatalog() {
        val catalog = catalogKeys()
        val offenders = screens().flatMap { (name, source) ->
            localizing.findAll(source).mapNotNull { match ->
                match.literal().takeIf { isCopy(it) && it !in catalog }?.let { "$name:${source.lineOf(match)}: \"$it\"" }
            }
        }
        assertEquals(emptyList(), offenders, "Add these to localizedCopyResources in LocalizedCopy.kt")
    }

    @Test
    fun policyConstantsShownOnScreenAreInTheCatalog() {
        val catalog = catalogKeys()
        val sources = root.listFiles { file -> file.extension == "kt" }.orEmpty().map { it.readText() }
        val offenders = screens().flatMap { (name, source) ->
            constantUse.findAll(source).mapNotNull { match ->
                val (owner, constant) = match.destructured
                val value = constantValue(sources, owner, constant) ?: return@mapNotNull null
                if (value in catalog) null else "$name:${source.lineOf(match)}: $owner.$constant = \"$value\""
            }
        }.distinct()
        assertEquals(emptyList(), offenders, "Add these to localizedCopyResources in LocalizedCopy.kt")
    }

    @Test
    @Config(qualifiers = "zh-rCN")
    fun simplifiedChinesePhoneSeesFormerlyHardCodedCopyInChinese() {
        showCopy()
        compose.onNodeWithText("帮我更新 Claude").assertIsDisplayed()
        compose.onNodeWithText("来自 Ada 的消息").assertIsDisplayed()
        compose.onNodeWithText("此对话正在等待你的回答。").assertIsDisplayed()
        compose.onNodeWithText("错误").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "zh-rTW")
    fun traditionalChinesePhoneSeesFormerlyHardCodedCopyInChinese() {
        showCopy()
        compose.onNodeWithText("幫我更新 Claude").assertIsDisplayed()
        compose.onNodeWithText("來自 Ada 的訊息").assertIsDisplayed()
        compose.onNodeWithText("此對話正在等待你的回答。").assertIsDisplayed()
        compose.onNodeWithText("錯誤").assertIsDisplayed()
    }

    private fun showCopy() = compose.setContent {
        Column {
            Text(stringResource(R.string.mobile_claude_update_do_it))
            Text(localizedMobileCopy(SearchHitRole.contentDescription(Message.Role.BOT, "Ada")))
            Text(localizedMobileCopy(RoutineRules.WAITING_ON_YOU))
            Text(localizedMobileCopy(ActivityReceipt.label(ActivityStatus.ERROR)))
        }
    }

    private fun screens(): List<Pair<String, String>> =
        root.listFiles { file -> file.extension == "kt" && file.name !in coveredElsewhere }.orEmpty()
            .sortedBy { it.name }
            .map { it.name to it.readText() }

    /** Words a person reads, not a bare number, emoji or `${…}` template. */
    private fun isCopy(literal: String): Boolean =
        literal !in allowed && Regex("[A-Za-z]{2}").containsMatchIn(literal.replace(template, ""))

    /** The English keys `localizedMobileCopy` knows. */
    private fun catalogKeys(): Set<String> =
        Regex("""^ {4}"((?:[^"\\]|\\.)*)" to R\.string""", RegexOption.MULTILINE)
            .findAll(File(root, "LocalizedCopy.kt").readText())
            .map { it.groupValues[1].unescaped() }
            .toSet()

    /** A `const val` (or `val`) string inside `object [owner]`, joined across `+` lines. */
    private fun constantValue(sources: List<String>, owner: String, constant: String): String? {
        for (source in sources) {
            val start = Regex("""\bobject $owner\b""").find(source)?.range?.first ?: continue
            val declaration = Regex("""\bval $constant\b(?:\s*:\s*String)?\s*=\s*((?:\s*$LITERAL\s*\+?)+)""")
                .find(source, start) ?: return null
            return Regex(LITERAL).findAll(declaration.groupValues[1]).joinToString("") { it.groupValues[1].unescaped() }
        }
        return null
    }

    private fun MatchResult.literal(): String = (groupValues.drop(1).firstOrNull { it.isNotEmpty() } ?: "").unescaped()

    private fun String.unescaped(): String = replace("\\$", "$").replace("\\\"", "\"")

    private fun String.lineOf(match: MatchResult): Int = substring(0, match.range.first).count { it == '\n' } + 1

    private companion object {
        const val LITERAL = """"((?:[^"\\]|\\.)*)""""

        /** An optional `if (…) ` before the literal, so `if (x) "A" else "B"` is caught too. */
        const val CONDITION = """(?:if\s*\((?:[^()]|\([^()]*\))*\)\s*)?"""

        /** Places that show a string as-is. */
        val raw = Regex(
            """(?:\bText\(\s*(?:text\s*=\s*)?|\b(?:contentDescription|stateDescription|onClickLabel)\s*=\s*)""" +
                CONDITION + LITERAL,
        )

        /** Places whose helpers run `localizedMobileCopy`, so the English must be a catalog key. */
        val localizing = Regex(
            """(?:\b(?:header|footer|title|subtitle|label|text|placeholder|\w*[eE]rror)\s*=\s*|""" +
                """\b(?:SettingsSection|SettingsRow|SettingsButton|Footnote|FormSection|ActionRow|IconNote)\(\s*)""" +
                LITERAL,
        )

        /** `localizedMobileCopy(TaskRules.CONTEXT_FOOTER)`, `footer = RoutineRules.WEBHOOKS_FOOTER`, … */
        val constantUse = Regex(
            """(?:localizedMobileCopy\(|\b(?:header|footer|title|subtitle|label|text|placeholder|description)\s*=\s*)""" +
                """([A-Z][A-Za-z]+)\.([A-Z][A-Z_0-9]+)\b""",
        )

        /** `${…}` (even one cut short by a nested quote) and `$name`. */
        val template = Regex("""\$\{[^}]*(?:\}|$)|\$\w+""")
    }
}
