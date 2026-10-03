package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.NotificationTarget
import com.openmausbot.companion.core.Routine
import com.openmausbot.companion.core.RoutineCalendar
import com.openmausbot.companion.core.RoutineCalendarItem
import com.openmausbot.companion.core.RoutineRun
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.abs
import kotlinx.coroutines.launch

/**
 * Routines on a calendar (MOCA-191) — the port of
 * `ios/App/RoutineCalendarView.swift`. A week strip over the chosen day's runs in
 * time order: what ran and how it went, and what is coming. The days are worked
 * out by [RoutineCalendar], the same rules as the desktop's calendar.
 */
@Composable
internal fun RoutineCalendarScreen(onBack: () -> Unit, onOpenChat: (Chat) -> Unit) {
    val session = LocalCompanion.current.session
    val state by session.state.collectAsState()
    val scope = rememberCoroutineScope()
    val zone = remember { ZoneId.systemDefault() }
    val locale = Locale.getDefault()

    var routines by remember { mutableStateOf<List<Routine>>(emptyList()) }
    var runs by remember { mutableStateOf<List<RoutineRun>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var selectedDay by rememberSaveable { mutableLongStateOf(LocalDate.now(zone).toEpochDay()) }
    var editor by rememberSaveable(stateSaver = RoutineEditorTarget.Saver) {
        mutableStateOf<RoutineEditorTarget?>(null)
    }

    suspend fun reload() {
        loading = true
        val loaded = session.loadRoutines()
        routines = loaded.routines
        runs = loaded.runs
        loading = false
    }
    LaunchedEffect(Unit) { reload() }

    val selected = LocalDate.ofEpochDay(selectedDay)
    val today = LocalDate.now(zone)
    val week = remember(selectedDay) { RoutineCalendar.week(selected) }
    val counts = remember(routines, runs, week) { week.map { RoutineCalendar.items(routines, runs, it, zone).size } }
    val dayItems = remember(routines, runs, selectedDay) { RoutineCalendar.items(routines, runs, selected, zone) }
    fun shiftWeek(weeks: Long) { selectedDay = selected.plusWeeks(weeks).toEpochDay() }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Text(
                text = selected.format(DateTimeFormatter.ofPattern("LLLL yyyy", locale)),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (selected != today) {
                TextButton(onClick = { selectedDay = today.toEpochDay() }) {
                    Text(stringResource(R.string.mobile_calendar_today))
                }
            }
            ChromeButton(
                icon = Icons.Filled.Add,
                contentDescription = stringResource(R.string.mobile_new_routine_32809dc6),
                onClick = { editor = RoutineEditorTarget.new() },
                size = 36.dp,
                glyph = 18.dp,
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 6.dp)
                // A sideways swipe turns the week.
                .pointerInput(Unit) {
                    var travel = 0f
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            if (abs(travel) > 60f) shiftWeek(if (travel < 0) 1 else -1)
                            travel = 0f
                        },
                    ) { _, dx -> travel += dx }
                },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TouchTarget(onClick = { shiftWeek(-1) }, contentDescription = stringResource(R.string.mobile_calendar_previous_week)) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = null)
            }
            week.forEachIndexed { index, day ->
                DayCell(
                    day = day,
                    isSelected = day == selected,
                    isToday = day == today,
                    count = counts.getOrElse(index) { 0 },
                    locale = locale,
                    onClick = { selectedDay = day.toEpochDay() },
                    modifier = Modifier.weight(1f),
                )
            }
            TouchTarget(onClick = { shiftWeek(1) }, contentDescription = stringResource(R.string.mobile_calendar_next_week)) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
            }
        }
        HorizontalDivider()

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 8.dp),
        ) {
            if (dayItems.isEmpty() && !loading) {
                item(key = "empty") {
                    Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                        Text(stringResource(R.string.mobile_calendar_empty_title), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.mobile_calendar_empty_body), fontSize = 14.sp, color = secondaryTint)
                    }
                }
            }
            items(dayItems, key = { it.id }) { item ->
                CalendarRunRow(
                    item = item,
                    bot = state.bot(item.run?.botId ?: item.routine?.botId ?: ""),
                    zone = zone,
                    locale = locale,
                    onClick = {
                        val run = item.run
                        val target = run?.let { NotificationTarget.from(it.botId, it.threadId) }
                        if (target != null) {
                            // A run opens the thread its results went to.
                            scope.launch { session.openNotification(target)?.let(onOpenChat) }
                        } else {
                            item.routine?.let { editor = RoutineEditorTarget.edit(it) }
                        }
                    },
                )
                HorizontalDivider(modifier = Modifier.padding(start = 20.dp))
            }
        }
    }

    editor?.let { target ->
        key(target.stateKey) {
            RoutineEditorSheet(
                target = target,
                onSaved = { scope.launch { reload() } },
                onDismiss = { editor = null },
            )
        }
    }
}

@Composable
private fun DayCell(
    day: LocalDate,
    isSelected: Boolean,
    isToday: Boolean,
    count: Int,
    locale: Locale,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = MaterialTheme.colorScheme.primary
    val ink = MaterialTheme.colorScheme.onSurface
    val description = day.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)) + ", " +
        if (count == 0) stringResource(R.string.mobile_calendar_empty_title)
        else stringResource(R.string.mobile_calendar_day_runs, count)
    Column(
        modifier = modifier
            .clickable(role = Role.Button, onClick = onClick)
            .semantics {
                contentDescription = description
                selected = isSelected
            }
            .testTag("calendar-day-$day")
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(day.dayOfWeek.getDisplayName(TextStyle.NARROW, locale), fontSize = 12.sp, color = secondaryTint)
        Box(
            modifier = Modifier
                .size(34.dp)
                .background(
                    when {
                        isSelected && isToday -> accent
                        isSelected -> ink
                        else -> Color.Transparent
                    },
                    CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = day.dayOfMonth.toString(),
                fontSize = 17.sp,
                fontWeight = if (isSelected || isToday) FontWeight.SemiBold else FontWeight.Normal,
                // Selected reads as the inverse of the page; today, in the accent.
                color = when {
                    isSelected && isToday -> MaterialTheme.colorScheme.onPrimary
                    isSelected -> MaterialTheme.colorScheme.surface
                    isToday -> accent
                    else -> ink
                },
            )
        }
        Box(
            modifier = Modifier
                .size(5.dp)
                .background(if (count > 0) secondaryTint else Color.Transparent, CircleShape),
        )
    }
}

/** One run on the day: when, what, for whom, and how it went. */
@Composable
private fun CalendarRunRow(
    item: RoutineCalendarItem,
    bot: Bot?,
    zone: ZoneId,
    locale: Locale,
    onClick: () -> Unit,
) {
    val time = Instant.ofEpochMilli(item.at.toLong()).atZone(zone)
        .format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(time, fontSize = 15.sp, color = secondaryTint, modifier = Modifier.widthIn(min = 64.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = item.routine?.name ?: item.run?.routineName.orEmpty(),
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = bot?.name ?: localizedMobileCopy(RoutineRules.DELETED_AGENT),
                fontSize = 13.sp,
                color = secondaryTint,
            )
        }
        val run = item.run
        if (run != null) {
            val status = RoutineRules.runStatus(run.status)
            val tint = runStatusTint(status)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                RunStatusIcon(status = status, tint = tint)
                Text(localizedMobileCopy(RoutineRules.runStatusLabel(run.status)), fontSize = 13.sp, color = tint)
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    painter = painterResource(R.drawable.ic_schedule),
                    contentDescription = null,
                    tint = secondaryTint,
                    modifier = Modifier.size(18.dp),
                )
                Text(stringResource(R.string.mobile_calendar_scheduled), fontSize = 13.sp, color = secondaryTint)
            }
        }
    }
}
