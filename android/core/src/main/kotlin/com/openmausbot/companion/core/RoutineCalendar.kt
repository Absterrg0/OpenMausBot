package com.openmausbot.companion.core

import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * One run on the routine calendar (MOCA-191): a receipt when [run] is set,
 * otherwise an upcoming run projected from [routine]'s schedule. Port of
 * `RoutineCalendarItem` in `ios/Sources/CompanionCore/RoutineCalendar.swift`.
 */
data class RoutineCalendarItem(
    val id: String,
    /** Milliseconds since 1970, like every timestamp on the wire. */
    val at: Double,
    /** Null for a receipt whose routine has since been deleted. */
    val routine: Routine?,
    /** The run that happened or is happening; null for an upcoming one. */
    val run: RoutineRun?,
)

/**
 * Which runs land on a day — a port of `projectedRoutineItems` in
 * src/lib/routine-calendar.ts (via the iOS `RoutineCalendar`), so the phone and
 * the desktop put the same work on the same day. Past and active runs come from
 * their receipts; upcoming ones are projected from each enabled routine's
 * schedule, and a receipt always replaces its projection. Daily times are read
 * in this device's zone, as the desktop reads them in its own.
 */
object RoutineCalendar {
    /** A routine that runs every few minutes would bury a day in receipts. */
    internal const val MAX_RECEIPTS_PER_ROUTINE = 12

    /** The seven days of the week holding [day], Monday first, as the desktop lays them out. */
    fun week(day: LocalDate): List<LocalDate> {
        val monday = day.minusDays((day.dayOfWeek.value - 1).toLong())
        return (0L until 7L).map { monday.plusDays(it) }
    }

    /** Everything on one day, in time order. */
    fun items(routines: List<Routine>, runs: List<RoutineRun>, day: LocalDate, zone: ZoneId): List<RoutineCalendarItem> {
        val from = day.atStartOfDay(zone).toInstant().toEpochMilli().toDouble()
        val to = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli().toDouble()
        val routineById = routines.associateBy { it.id }

        val receiptCounts = mutableMapOf<String, Int>()
        val visibleRuns = runs
            .filter { it.scheduledFor >= from && it.scheduledFor < to }
            .sortedByDescending { it.scheduledFor }
            .filter { run ->
                if (run.status in setOf("queued", "running", "waiting")) return@filter true
                // A routine may since have been edited or deleted, so its current
                // definition cannot say whether this history came from a dense
                // interval. Trim terminal history instead.
                val count = receiptCounts[run.routineId] ?: 0
                if (count >= MAX_RECEIPTS_PER_ROUTINE) return@filter false
                receiptCounts[run.routineId] = count + 1
                true
            }
        val items = visibleRuns.map { run ->
            RoutineCalendarItem("run-${run.id}", run.scheduledFor, routineById[run.routineId], run)
        }.toMutableList()

        fun hasReceipt(routineId: String, at: Double) =
            runs.any { it.routineId == routineId && kotlin.math.abs(it.scheduledFor - at) < 60_000 }
        fun project(routine: Routine, at: Double) {
            if (at < from || at >= to || hasReceipt(routine.id, at)) return
            items += RoutineCalendarItem("next-${routine.id}-${at.toLong()}", at, routine, null)
        }

        for (routine in routines) {
            if (!routine.enabled) continue
            val schedule = routine.schedule
            when (schedule.type) {
                RoutineSchedule.Kind.ONCE -> schedule.at?.let { project(routine, it) }
                RoutineSchedule.Kind.DAILY -> {
                    val time = schedule.time ?: continue
                    val weekdays = schedule.weekdays ?: continue
                    val at = localTime(time, day, zone) ?: continue
                    // The wire numbers weekdays as JavaScript does: 0 = Sunday.
                    if (day.dayOfWeek.value % 7 !in weekdays || at < routine.createdAt) continue
                    project(routine, at)
                }
                // The scheduler skips overlapping and stale ticks, so its persisted
                // next run is the only future occurrence to show; a schedule from a
                // newer desktop (cron) is read the same way.
                RoutineSchedule.Kind.INTERVAL, RoutineSchedule.Kind.UNKNOWN ->
                    routine.nextRunAt?.let { project(routine, it) }
            }
        }
        return items.sortedBy { it.at }
    }

    /** "HH:mm" on [day], in milliseconds. */
    internal fun localTime(time: String, day: LocalDate, zone: ZoneId): Double? {
        val parts = time.split(":").mapNotNull { it.toIntOrNull() }
        if (parts.size != 2 || parts[0] !in 0..23 || parts[1] !in 0..59) return null
        return day.atTime(LocalTime.of(parts[0], parts[1])).atZone(zone).toInstant().toEpochMilli().toDouble()
    }
}
