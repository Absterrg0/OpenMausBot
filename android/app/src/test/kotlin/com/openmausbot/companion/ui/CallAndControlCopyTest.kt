package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import java.io.File
import kotlin.test.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * MOCA-291: Live calls and browser / computer control wrote their copy
 * straight into Kotlin, so it stayed English on a Chinese phone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallAndControlCopyTest {
    @get:Rule val compose = createComposeRule()

    private val screens = listOf(
        "LiveCallBar.kt",
        "LiveCallBanner.kt",
        "LiveCallSettingsSheet.kt",
        "BrowserControlScreen.kt",
        "ComputerScreen.kt",
    )

    /** A user-facing English literal handed straight to the UI. */
    private val hardCoded = Regex(
        """(Text\(\s*"|contentDescription\s*=\s*(if \([^)]*\)\s*)?"|(label|placeholder|header|footer|text|title)\s*=\s*"|failure\s*=\s*"|\?:\s*")[A-Z][a-z]""",
    )

    @Test
    fun callAndControlScreensRouteTheirCopyThroughTheCatalog() {
        val root = File("src/main/kotlin/com/openmausbot/companion/ui").takeIf(File::isDirectory)
            ?: File("app/src/main/kotlin/com/openmausbot/companion/ui")
        val offenders = screens.flatMap { name ->
            File(root, name).readLines().mapIndexedNotNull { index, line ->
                if (hardCoded.containsMatchIn(line)) "$name:${index + 1}: ${line.trim()}" else null
            }
        }
        assertEquals(emptyList(), offenders)
    }

    @Test
    @Config(qualifiers = "zh-rCN")
    fun simplifiedChinesePhoneSeesCallAndControlCopyInChinese() {
        showCopy()
        compose.onNodeWithText("挂断").assertIsDisplayed()
        compose.onNodeWithText("接管控制").assertIsDisplayed()
        compose.onNodeWithText("实时通话设置").assertIsDisplayed()
        compose.onNodeWithText("正在连接…").assertIsDisplayed()
        compose.onNodeWithText("通话已结束。").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "zh-rTW")
    fun traditionalChinesePhoneSeesCallAndControlCopyInChinese() {
        showCopy()
        compose.onNodeWithText("掛斷").assertIsDisplayed()
        compose.onNodeWithText("接管控制").assertIsDisplayed()
        compose.onNodeWithText("即時通話設定").assertIsDisplayed()
        compose.onNodeWithText("正在連線…").assertIsDisplayed()
        compose.onNodeWithText("通話已結束。").assertIsDisplayed()
    }

    private fun showCopy() = compose.setContent {
        Column {
            Text(localizedMobileCopy("Hang up"))
            Text(localizedMobileCopy("Take control"))
            Text(localizedMobileCopy("Live call settings"))
            Text(localizedMobileCopy(LiveCallRules.CONNECTING))
            Text(localizedMobileCopy(LiveCallRules.CALL_ENDED))
        }
    }
}
