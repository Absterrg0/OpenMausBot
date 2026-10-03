package com.openmausbot.companion.core

import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.DayOfWeek
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The phone's routine calendar (MOCA-191), against the desktop's rules in
 * src/lib/routine-calendar.ts and the iOS port: the same runs land on the same
 * days, a run's receipt replaces its projection, and paused or skipped work is
 * never shown.
 */
class RoutineCalendarTest {
    private val zone = ZoneId.of("Asia/Kolkata")
    private val wednesday = LocalDate.of(2026, 10, 7)

    private fun ms(day: LocalDate, hour: Int, minute: Int = 0): Double =
        day.atTime(LocalTime.of(hour, minute)).atZone(zone).toInstant().toEpochMilli().toDouble()

    private fun routine(
        id: String,
        schedule: String,
        enabled: Boolean = true,
        nextRunAt: Double? = null,
        createdAt: Double = ms(wednesday.minusDays(30), 0),
    ): Routine = CompanionJson.decodeFromString(
        """{"id":"$id","name":"$id name","prompt":"p","botId":"b1","runOn":"maus","enabled":$enabled,
            "schedule":$schedule,"durationMinutes":30,"nextRunAt":${nextRunAt ?: "null"},"createdAt":$createdAt,"updatedAt":$createdAt}""",
    )

    private fun run(id: String, routine: String, at: Double, status: String = "completed"): RoutineRun =
        CompanionJson.decodeFromString(
            """{"id":"$id","routineId":"$routine","routineName":"$routine name","botId":"b1","runOn":"maus",
                "scheduledFor":$at,"status":"$status","manual":false,"createdAt":$at}""",
        )

    @Test
    fun theWeekStartsOnMondayLikeTheDesktop() {
        val week = RoutineCalendar.week(wednesday)
        assertEquals(7, week.size)
        assertEquals(DayOfWeek.MONDAY, week.first().dayOfWeek)
        assertEquals(LocalDate.of(2026, 10, 5), week.first())
        assertEquals(LocalDate.of(2026, 10, 11), week.last())
    }

    @Test
    fun aDailyRoutineLandsOnItsWeekdaysAtItsTime() {
        // weekdays use JavaScript's numbering: 0 = Sunday, 3 = Wednesday.
        val brief = routine("brief", """{"type":"daily","time":"09:00","weekdays":[3,4]}""")
        val items = RoutineCalendar.items(listOf(brief), emptyList(), wednesday, zone)
        assertEquals(listOf(ms(wednesday, 9)), items.map { it.at })
        assertNull(items.single().run)
        assertTrue(RoutineCalendar.items(listOf(brief), emptyList(), wednesday.minusDays(1), zone).isEmpty())
    }

    @Test
    fun aReceiptReplacesItsProjectionAndKeepsItsOutcome() {
        val brief = routine("brief", """{"type":"daily","time":"09:00","weekdays":[3]}""")
        val done = run("run1", "brief", ms(wednesday, 9), status = "failed")
        val items = RoutineCalendar.items(listOf(brief), listOf(done), wednesday, zone)
        assertEquals(1, items.size)
        assertEquals("failed", items.single().run?.status)
        assertEquals("brief", items.single().routine?.id)
    }

    @Test
    fun oneTimeAndIntervalRoutinesShowOnlyWhatTheSchedulerWillRun() {
        val once = routine("once", """{"type":"once","at":${ms(wednesday, 14, 30)}}""")
        val interval = routine("every", """{"type":"interval","everyMinutes":60,"anchorAt":0}""", nextRunAt = ms(wednesday, 11))
        val items = RoutineCalendar.items(listOf(once, interval), emptyList(), wednesday, zone)
        assertEquals(listOf("every", "once"), items.map { it.routine?.id })
    }

    @Test
    fun pausedNewerAndNotYetCreatedWorkIsNeverProjected() {
        val paused = routine("paused", """{"type":"daily","time":"09:00","weekdays":[3]}""", enabled = false)
        val fresh = routine("fresh", """{"type":"daily","time":"09:00","weekdays":[3]}""", createdAt = ms(wednesday, 10))
        val cron = routine("cron", """{"type":"cron","expression":"0 8 * * *","timeZone":"UTC"}""", nextRunAt = ms(wednesday, 13))
        val items = RoutineCalendar.items(listOf(paused, fresh, cron), emptyList(), wednesday, zone)
        assertEquals(listOf("cron"), items.map { it.routine?.id })
    }

    @Test
    fun terminalHistoryIsTrimmedButActiveRunsAlwaysShow() {
        val every = routine("every", """{"type":"interval","everyMinutes":5,"anchorAt":0}""")
        val runs = (0 until 20).map { run("r$it", "every", ms(wednesday, 1, it * 2)) } +
            run("live", "every", ms(wednesday, 2), status = "running")
        val items = RoutineCalendar.items(listOf(every), runs, wednesday, zone)
        assertEquals(12, items.count { it.run?.status == "completed" })
        assertTrue(items.any { it.run?.id == "live" })
        assertEquals(items.map { it.at }.sorted(), items.map { it.at })
    }
}
